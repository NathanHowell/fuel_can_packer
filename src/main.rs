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
struct SolutionItem {
    keep: bool,
    final_fuel: i32,
}

fn solve_with_z3(cans: &[Can], total_fuel: i32) -> Result<Vec<SolutionItem>, String> {
    let opt = Optimize::new();

    let mut keep_vars = Vec::new();
    let mut fuel_vars = Vec::new();

    for (idx, can) in cans.iter().enumerate() {
        let keep = Int::new_const(format!("keep_{idx}"));
        let fuel = Int::new_const(format!("fuel_{idx}"));

        // keep is 0 or 1
        opt.assert(&keep.ge(&Int::from_i64(0)));
        opt.assert(&keep.le(&Int::from_i64(1)));

        // fuel bounds and link to keep
        opt.assert(&fuel.ge(&Int::from_i64(0)));
        opt.assert(&fuel.le(&Int::from_i64(can.spec.capacity as i64)));
        let keep_cap = Int::mul(&[keep.clone(), Int::from_i64(can.spec.capacity as i64)]);
        opt.assert(&fuel.le(&keep_cap));

        keep_vars.push(keep);
        fuel_vars.push(fuel);
    }

    let fuel_sum = Int::add(fuel_vars.iter().cloned().collect::<Vec<_>>().as_slice());
    opt.assert(&fuel_sum.eq(&Int::from_i64(total_fuel as i64)));

    let empty_terms: Vec<Int> = keep_vars
        .iter()
        .zip(cans.iter())
        .map(|(keep, can)| Int::mul(&[keep.clone(), Int::from_i64(can.spec.empty_weight as i64)]))
        .collect();
    let empty_cost = Int::add(empty_terms.iter().cloned().collect::<Vec<_>>().as_slice());
    opt.minimize(&empty_cost);

    match opt.check(&[]) {
        z3::SatResult::Sat => {
            let model = opt.get_model().ok_or("no model produced")?;
            let mut out = Vec::new();
            for (keep, fuel) in keep_vars.iter().zip(fuel_vars.iter()) {
                let keep_val = model
                    .eval(keep, true)
                    .and_then(|v| v.as_i64())
                    .ok_or("missing keep value")?;
                let fuel_val = model
                    .eval(fuel, true)
                    .and_then(|v| v.as_i64())
                    .ok_or("missing fuel value")?;
                out.push(SolutionItem {
                    keep: keep_val == 1,
                    final_fuel: fuel_val as i32,
                });
            }
            Ok(out)
        }
        z3::SatResult::Unknown => Err("solver returned unknown".into()),
        z3::SatResult::Unsat => Err("problem is unsatisfiable".into()),
    }
}

fn print_plan(cans: &[Can], solution: &[SolutionItem]) {
    let mut recipients = Vec::new();
    let mut donors = Vec::new();

    for (can, sol) in cans.iter().zip(solution.iter()) {
        if sol.keep {
            let delta = sol.final_fuel - can.fuel;
            recipients.push((can, sol, delta));
        }
        let surplus = can.fuel - sol.final_fuel;
        if surplus > 0 {
            donors.push((can, surplus));
        }
    }

    recipients.sort_by(|a, b| b.2.cmp(&a.2));
    donors.sort_by(|a, b| b.1.cmp(&a.1));

    println!("\nTransfer plan:");

    let mut donor_idx = 0;
    let mut donor_remaining = donors.first().map(|(_, s)| *s).unwrap_or(0);

    for (can, sol, delta) in recipients {
        if delta <= 0 {
            continue;
        }
        let mut incoming = Vec::new();
        let mut need = delta;

        while need > 0 && donor_idx < donors.len() {
            let (donor_can, _) = donors[donor_idx];
            let take = donor_remaining.min(need);
            incoming.push((donor_can, take));
            need -= take;
            donor_remaining -= take;
            if donor_remaining == 0 {
                donor_idx += 1;
                donor_remaining = donors
                    .get(donor_idx)
                    .map(|(_, s)| *s)
                    .unwrap_or(0);
            }
        }

        let target_gross = sol.final_fuel + can.spec.empty_weight;
        println!(
            "- {} ({}): add {} g -> target fuel {} g (gross {} g)",
            can.id, can.spec.name, delta, sol.final_fuel, target_gross
        );
        for (donor, amount) in incoming {
            println!(
                "    from {} ({}): {} g",
                donor.id, donor.spec.name, amount
            );
        }
    }

    let kept: Vec<_> = solution
        .iter()
        .zip(cans.iter())
        .filter(|(sol, _)| sol.keep)
        .collect();
    let total_gross: i32 = kept
        .iter()
        .map(|(sol, can)| sol.final_fuel + can.spec.empty_weight)
        .sum();
    println!("\nCarry {} cans, total gross weight {} g.", kept.len(), total_gross);
}
