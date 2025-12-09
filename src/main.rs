use std::io::{self, Write};

use z3::{ast::Int, Optimize};

#[derive(Clone, Copy, Debug)]
struct CanSpec {
    name: &'static str,
    capacity: i32,
    empty_weight: i32,
}

#[derive(Clone, Debug)]
struct Can {
    id: String,
    spec: CanSpec,
    fuel: i32,
}

const MSR_110: CanSpec = CanSpec {
    name: "MSR 110g",
    capacity: 110,
    empty_weight: 101,
};
const MSR_227: CanSpec = CanSpec {
    name: "MSR 227g",
    capacity: 227,
    empty_weight: 151,
};
const MSR_450: CanSpec = CanSpec {
    name: "MSR 450g",
    capacity: 450,
    empty_weight: 216,
};

fn main() {
    println!("Fuel can packer (MSR only)");
    println!("Enter gross weights (g) for each size, space separated. Leave blank if none.\n");

    let mut cans = Vec::new();
    cans.extend(read_cans_for_size(MSR_110, "110g"));
    cans.extend(read_cans_for_size(MSR_227, "227g"));
    cans.extend(read_cans_for_size(MSR_450, "450g"));

    if cans.is_empty() {
        eprintln!("No cans provided, exiting.");
        return;
    }

    let total_fuel: i32 = cans.iter().map(|c| c.fuel).sum();
    println!("Detected total fuel: {} g across {} cans.", total_fuel, cans.len());

    let solution = solve_with_z3(&cans, total_fuel).unwrap_or_else(|err| {
        eprintln!("Solver failed: {err}");
        std::process::exit(1);
    });

    print_plan(&cans, &solution);
}

fn read_line(prompt: &str) -> io::Result<String> {
    print!("{prompt}");
    io::stdout().flush()?;
    let mut buf = String::new();
    io::stdin().read_line(&mut buf)?;
    Ok(buf.trim().to_string())
}

fn read_cans_for_size(spec: CanSpec, prompt_label: &str) -> Vec<Can> {
    let line = read_line(&format!("Gross weights for {} cans: ", prompt_label))
        .expect("failed to read stdin");
    if line.trim().is_empty() {
        return Vec::new();
    }

    line.split_whitespace()
        .enumerate()
        .map(|(idx, raw)| {
            let gross: i32 = raw.parse().expect("invalid integer weight");
            let fuel = gross - spec.empty_weight;
            if fuel < 0 {
                panic!(
                    "Gross weight {}g is lighter than empty can weight {}g",
                    gross, spec.empty_weight
                );
            }
            Can {
                id: format!("{} #{}", prompt_label, idx + 1),
                spec,
                fuel,
            }
        })
        .collect()
}

#[derive(Debug)]
struct Solution {
    keep: Vec<bool>,
    final_fuel: Vec<i32>,
    transfers: Vec<Vec<i32>>, // donors x recipients
}

fn solve_with_z3(cans: &[Can], total_fuel: i32) -> Result<Solution, String> {
    let opt = Optimize::new();
    let n = cans.len();

    let mut keep_vars = Vec::new();
    let mut fuel_vars = Vec::new();

    // transfer[d][r]
    let mut transfer_vars: Vec<Vec<Int>> = Vec::with_capacity(n);
    let mut pair_vars: Vec<Vec<Int>> = Vec::with_capacity(n);

    for d in 0..n {
        let mut row = Vec::with_capacity(n);
        let mut prow = Vec::with_capacity(n);
        for r in 0..n {
            let t = Int::new_const(format!("t_{d}_{r}"));
            let p = Int::new_const(format!("p_{d}_{r}"));
            opt.assert(&t.ge(&Int::from_i64(0)));
            opt.assert(&p.ge(&Int::from_i64(0)));
            opt.assert(&p.le(&Int::from_i64(1)));
            if d == r {
                opt.assert(&t.eq(&Int::from_i64(0)));
                opt.assert(&p.eq(&Int::from_i64(0)));
            } else {
                let big_m = Int::from_i64(total_fuel as i64);
                // t <= p * M
                opt.assert(&t.le(&Int::mul(&[p.clone(), big_m])));
            }
            row.push(t);
            prow.push(p);
        }
        transfer_vars.push(row);
        pair_vars.push(prow);
    }

    for (idx, can) in cans.iter().enumerate() {
        let keep = Int::new_const(format!("keep_{idx}"));
        let fuel = Int::new_const(format!("fuel_{idx}"));

        opt.assert(&keep.ge(&Int::from_i64(0)));
        opt.assert(&keep.le(&Int::from_i64(1)));

        opt.assert(&fuel.ge(&Int::from_i64(0)));
        opt.assert(&fuel.le(&Int::from_i64(can.spec.capacity as i64)));
        let keep_cap = Int::mul(&[keep.clone(), Int::from_i64(can.spec.capacity as i64)]);
        opt.assert(&fuel.le(&keep_cap));

        // Flow conservation: final = initial + inflow - outflow
        let inflow = Int::add(transfer_vars.iter().map(|row| row[idx].clone()).collect::<Vec<_>>().as_slice());
        let outflow = Int::add(transfer_vars[idx].clone().as_slice());
        let init = Int::from_i64(can.fuel as i64);
        opt.assert(&fuel.eq(&init + inflow - outflow.clone()));

        // Outflow limited by initial fuel
        opt.assert(&outflow.le(&init));

        keep_vars.push(keep);
        fuel_vars.push(fuel);
    }

    // Total fuel stays constant already via flows; enforce non-neg
    let fuel_sum = Int::add(fuel_vars.iter().cloned().collect::<Vec<_>>().as_slice());
    opt.assert(&fuel_sum.eq(&Int::from_i64(total_fuel as i64)));

    // Objective: minimize empty weight then pairings (weighted single objective)
    let empty_terms: Vec<Int> = keep_vars
        .iter()
        .zip(cans.iter())
        .map(|(keep, can)| Int::mul(&[keep.clone(), Int::from_i64(can.spec.empty_weight as i64)]))
        .collect();
    let empty_cost = Int::add(empty_terms.iter().cloned().collect::<Vec<_>>().as_slice());

    let pair_count_terms: Vec<Int> = pair_vars
        .iter()
        .flat_map(|row| row.iter().cloned())
        .collect();
    let pair_count = Int::add(pair_count_terms.as_slice());

    // Weight pairs so empty weight is always preferred first.
    // Max empty weight ~1000s; max pair count n^2 <= 10k typical. Weight big enough.
    let combined = Int::add(&[
        Int::mul(&[empty_cost.clone(), Int::from_i64(10_000)]),
        pair_count.clone(),
    ]);
    opt.minimize(&combined);

    match opt.check(&[]) {
        z3::SatResult::Sat => {
            let model = opt.get_model().ok_or("no model produced")?;
            let mut keep_out = Vec::new();
            let mut fuel_out = Vec::new();
            for (keep, fuel) in keep_vars.iter().zip(fuel_vars.iter()) {
                let keep_val = model
                    .eval(keep, true)
                    .and_then(|v| v.as_i64())
                    .ok_or("missing keep value")?;
                let fuel_val = model
                    .eval(fuel, true)
                    .and_then(|v| v.as_i64())
                    .ok_or("missing fuel value")?;
                keep_out.push(keep_val == 1);
                fuel_out.push(fuel_val as i32);
            }
            let mut transfers_out = vec![vec![0i32; n]; n];
            for d in 0..n {
                for r in 0..n {
                    let tval = model
                        .eval(&transfer_vars[d][r], true)
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    transfers_out[d][r] = tval as i32;
                }
            }
            Ok(Solution {
                keep: keep_out,
                final_fuel: fuel_out,
                transfers: transfers_out,
            })
        }
        z3::SatResult::Unknown => Err("solver returned unknown".into()),
        z3::SatResult::Unsat => Err("problem is unsatisfiable".into()),
    }
}

fn print_plan(cans: &[Can], solution: &Solution) {
    let mut recipients = Vec::new();
    for (idx, can) in cans.iter().enumerate() {
        if solution.keep[idx] {
            let delta = solution.final_fuel[idx] - can.fuel;
            recipients.push((idx, can, delta));
        }
    }
    recipients.sort_by(|a, b| b.2.cmp(&a.2));

    println!("\nTransfer plan:");
    for (idx, can, delta) in recipients {
        if delta <= 0 {
            continue;
        }
        let target_gross = solution.final_fuel[idx] + can.spec.empty_weight;
        println!(
            "- {} ({}): add {} g -> target fuel {} g (gross {} g)",
            can.id, can.spec.name, delta, solution.final_fuel[idx], target_gross
        );
        let mut donors: Vec<(usize, i32)> = solution
            .transfers
            .iter()
            .enumerate()
            .map(|(d_idx, row)| (d_idx, row[idx]))
            .filter(|(d_idx, amt)| *amt > 0 && *d_idx != idx)
            .collect();
        donors.sort_by(|a, b| b.1.cmp(&a.1));
        for (d_idx, amt) in donors {
            let donor = &cans[d_idx];
            println!(
                "    from {} ({}): {} g",
                donor.id, donor.spec.name, amt
            );
        }
    }

    let kept_idxs: Vec<_> = solution
        .keep
        .iter()
        .enumerate()
        .filter_map(|(idx, keep)| keep.then_some(idx))
        .collect();
    let total_gross: i32 = kept_idxs
        .iter()
        .map(|idx| solution.final_fuel[*idx] + cans[*idx].spec.empty_weight)
        .sum();
    println!(
        "\nCarry {} cans, total gross weight {} g.",
        kept_idxs.len(),
        total_gross
    );
}
