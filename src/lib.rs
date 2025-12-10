use serde::{Deserialize, Serialize};

#[cfg(not(feature = "solver_z3"))]
use std::cmp::Reverse;
use std::fmt::Write as _;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct CanSpec {
    pub name: &'static str,
    pub capacity: i32,
    pub empty_weight: i32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Can {
    pub id: String,
    pub spec: CanSpec,
    pub gross: i32,
    pub fuel: i32,
}

pub const MSR_110: CanSpec = CanSpec {
    name: "MSR 110g",
    capacity: 110,
    empty_weight: 101,
};
pub const MSR_227: CanSpec = CanSpec {
    name: "MSR 227g",
    capacity: 227,
    empty_weight: 147,
};
pub const MSR_450: CanSpec = CanSpec {
    name: "MSR 450g",
    capacity: 450,
    empty_weight: 216,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub keep: Vec<bool>,
    pub final_fuel: Vec<i32>,
    pub transfers: Vec<Vec<i32>>, // donors x recipients
}

#[derive(Debug, Clone, Deserialize)]
pub struct GrossInput {
    pub msr_110: Vec<i32>,
    pub msr_227: Vec<i32>,
    pub msr_450: Vec<i32>,
}

pub fn build_cans_from_gross(input: &GrossInput) -> Result<Vec<Can>, String> {
    let mut cans = Vec::new();
    push_cans(&mut cans, MSR_110, &input.msr_110)?;
    push_cans(&mut cans, MSR_227, &input.msr_227)?;
    push_cans(&mut cans, MSR_450, &input.msr_450)?;
    Ok(cans)
}

fn push_cans(out: &mut Vec<Can>, spec: CanSpec, gross_list: &[i32]) -> Result<(), String> {
    for gross in gross_list {
        let fuel = gross - spec.empty_weight;
        if fuel < 0 {
            return Err(format!(
                "Gross weight {}g for {} is lighter than empty can weight {}g",
                gross, spec.name, spec.empty_weight
            ));
        }
        out.push(Can {
            id: String::new(),
            spec,
            gross: *gross,
            fuel,
        });
    }
    Ok(())
}

pub fn assign_ids(cans: &mut [Can]) {
    for (idx, can) in cans.iter_mut().enumerate() {
        can.id = format!("Can #{} ({}g start)", idx + 1, can.gross);
    }
}

pub fn total_fuel(cans: &[Can]) -> i32 {
    cans.iter().map(|c| c.fuel).sum()
}

pub fn solve_plan(cans: &[Can]) -> Result<Plan, String> {
    if cans.is_empty() {
        return Err("no cans provided".into());
    }
    #[cfg(feature = "solver_z3")]
    {
        solve_with_z3(cans, total_fuel(cans))
    }
    #[cfg(not(feature = "solver_z3"))]
    {
        solve_greedy(cans)
    }
}

#[cfg(feature = "solver_z3")]
fn solve_with_z3(cans: &[Can], total_fuel: i32) -> Result<Plan, String> {
    use z3::{ast::Int, Optimize};

    let opt = Optimize::new();
    let n = cans.len();

    let mut keep_vars = Vec::new();
    let mut fuel_vars = Vec::new();

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

        let inflow =
            Int::add(transfer_vars.iter().map(|row| row[idx].clone()).collect::<Vec<_>>().as_slice());
        let outflow = Int::add(transfer_vars[idx].clone().as_slice());
        let init = Int::from_i64(can.fuel as i64);
        opt.assert(&fuel.eq(&init + inflow - outflow.clone()));
        opt.assert(&outflow.le(&init));

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

    let pair_count_terms: Vec<Int> = pair_vars
        .iter()
        .flat_map(|row| row.iter().cloned())
        .collect();
    let pair_count = Int::add(pair_count_terms.as_slice());

    let transfer_terms: Vec<Int> = transfer_vars
        .iter()
        .enumerate()
        .flat_map(|(d, row)| {
            row.iter()
                .enumerate()
                .filter_map(move |(r, t)| if d == r { None } else { Some(t.clone()) })
        })
        .collect();
    let transfer_total = Int::add(transfer_terms.as_slice());

    opt.minimize(&empty_cost);
    opt.minimize(&pair_count);
    opt.minimize(&transfer_total);

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
            Ok(Plan {
                keep: keep_out,
                final_fuel: fuel_out,
                transfers: transfers_out,
            })
        }
        z3::SatResult::Unknown => Err("solver returned unknown".into()),
        z3::SatResult::Unsat => Err("problem is unsatisfiable".into()),
    }
}

#[cfg(not(feature = "solver_z3"))]
fn solve_greedy(cans: &[Can]) -> Result<Plan, String> {
    let total_fuel: i32 = cans.iter().map(|c| c.fuel).sum();
    if total_fuel == 0 {
        return Ok(Plan {
            keep: vec![false; cans.len()],
            final_fuel: vec![0; cans.len()],
            transfers: vec![vec![0; cans.len()]; cans.len()],
        });
    }

    // Brute force subset search for minimal empty weight with enough capacity.
    let n = cans.len();
    let mut best_keep: Option<Vec<bool>> = None;
    let mut best_weight = i32::MAX;
    let mut best_count = usize::MAX;
    for mask in 1usize..(1usize << n) {
        let mut capacity = 0;
        let mut empty_weight = 0;
        let mut count = 0;
        let mut keep_flags = vec![false; n];
        for i in 0..n {
            if mask & (1usize << i) != 0 {
                capacity += cans[i].spec.capacity;
                empty_weight += cans[i].spec.empty_weight;
                count += 1;
                keep_flags[i] = true;
            }
        }
        if capacity < total_fuel {
            continue;
        }
        if empty_weight < best_weight || (empty_weight == best_weight && count < best_count) {
            best_weight = empty_weight;
            best_count = count;
            best_keep = Some(keep_flags);
        }
    }

    let keep = best_keep.ok_or("unable to carry enough capacity")?;

    let mut final_fuel = vec![0; n];
    let mut transfers = vec![vec![0; n]; n];

    // Start by keeping current fuel in kept cans; we'll pour donor fuel into them.
    let mut remaining = total_fuel;
    for (idx, can) in cans.iter().enumerate() {
        if keep[idx] {
            final_fuel[idx] = can.fuel;
            remaining -= can.fuel;
        }
    }

    // Distribute remaining fuel to kept cans by spare capacity.
    let mut kept_idxs: Vec<usize> = (0..n).filter(|i| keep[*i]).collect();
    kept_idxs.sort_by_key(|i| Reverse(cans[*i].spec.capacity - final_fuel[*i]));
    for idx in kept_idxs {
        if remaining <= 0 {
            break;
        }
        let spare = cans[idx].spec.capacity - final_fuel[idx];
        let give = spare.min(remaining);
        final_fuel[idx] += give;
        remaining -= give;
    }

    if remaining > 0 {
        return Err("could not fit all fuel into kept cans".into());
    }

    // Compute transfer plan: empty the cans we are not keeping into kept ones with deficits.
    let mut deficits: Vec<(usize, i32)> = final_fuel
        .iter()
        .enumerate()
        .filter_map(|(idx, target)| {
            let need = *target - cans[idx].fuel;
            if need > 0 {
                Some((idx, need))
            } else {
                None
            }
        })
        .collect();
    let donors: Vec<(usize, i32)> = cans
        .iter()
        .enumerate()
        .filter_map(|(idx, can)| {
            let mut available = can.fuel;
            if keep[idx] {
                let target = final_fuel[idx];
                if target < available {
                    available -= target;
                    Some((idx, available))
                } else {
                    None
                }
            } else {
                Some((idx, available))
            }
        })
        .collect();

    for (d_idx, available) in donors {
        let mut d_available = available;
        for (r_idx, need) in deficits.iter_mut() {
            if *need == 0 {
                continue;
            }
            let give = d_available.min(*need);
            if give == 0 {
                continue;
            }
            transfers[d_idx][*r_idx] += give;
            d_available -= give;
            *need -= give;
            if d_available == 0 {
                break;
            }
        }
        if d_available > 0 {
            // If a donor still has fuel (possible when we kept the donor and target < start fuel),
            // just leave it; final_fuel already accounts for it.
            continue;
        }
    }

    if deficits.iter().any(|(_, need)| *need > 0) {
        return Err("not enough donor fuel to satisfy plan".into());
    }

    Ok(Plan {
        keep,
        final_fuel,
        transfers,
    })
}

pub fn format_plan(cans: &[Can], plan: &Plan) -> String {
    let mut out = String::new();
    let mut recipients = Vec::new();
    for (idx, can) in cans.iter().enumerate() {
        if plan.keep[idx] {
            let delta = plan.final_fuel[idx] - can.fuel;
            recipients.push((idx, can, delta));
        }
    }
    recipients.sort_by(|a, b| b.2.cmp(&a.2));

    writeln!(&mut out, "\nTransfer plan:").ok();
    for (idx, can, delta) in recipients {
        if delta <= 0 {
            continue;
        }
        let target_gross = plan.final_fuel[idx] + can.spec.empty_weight;
        writeln!(
            &mut out,
            "- {} ({}): add {} g -> target fuel {} g (gross {} g, start gross {} g)",
            can.id,
            can.spec.name,
            delta,
            plan.final_fuel[idx],
            target_gross,
            can.gross
        )
        .ok();
        let mut donors: Vec<(usize, i32)> = plan
            .transfers
            .iter()
            .enumerate()
            .map(|(d_idx, row)| (d_idx, row[idx]))
            .filter(|(d_idx, amt)| *amt > 0 && *d_idx != idx)
            .collect();
        donors.sort_by(|a, b| b.1.cmp(&a.1));
        for (d_idx, amt) in donors {
            let donor = &cans[d_idx];
            writeln!(
                &mut out,
                "    from {} ({}): {} g",
                donor.id, donor.spec.name, amt
            )
            .ok();
        }
    }

    let kept_idxs: Vec<_> = plan
        .keep
        .iter()
        .enumerate()
        .filter_map(|(idx, keep)| keep.then_some(idx))
        .collect();
    let total_gross: i32 = kept_idxs
        .iter()
        .map(|idx| plan.final_fuel[*idx] + cans[*idx].spec.empty_weight)
        .sum();
    writeln!(
        &mut out,
        "\nCarry {} cans, total gross weight {} g.",
        kept_idxs.len(),
        total_gross
    )
    .ok();

    writeln!(&mut out, "\nFinal fuel per can (including empties):").ok();
    for (idx, can) in cans.iter().enumerate() {
        let final_fuel = plan.final_fuel[idx];
        let final_gross = final_fuel + can.spec.empty_weight;
        writeln!(
            &mut out,
            "- {} ({}): start gross {} g, final fuel {} g, final gross {} g{}",
            can.id,
            can.spec.name,
            can.gross,
            final_fuel,
            final_gross,
            if plan.keep[idx] { "" } else { " (left behind)" }
        )
        .ok();
    }

    out
}

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn compute_plan_text(input: JsValue) -> Result<String, JsValue> {
    let request: GrossInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("invalid input: {e}")))?;

    let mut cans =
        build_cans_from_gross(&request).map_err(|e| JsValue::from_str(&format!("input error: {e}")))?;
    assign_ids(&mut cans);
    let plan = solve_plan(&cans).map_err(|e| JsValue::from_str(&e))?;
    Ok(format_plan(&cans, &plan))
}
