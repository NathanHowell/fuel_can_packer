use std::io::{self, Write};

use fuel_can_packer::{assign_ids, build_cans_from_gross, format_plan, solve_plan, total_fuel, GrossInput};

fn main() {
    println!("Fuel can packer (MSR only)");
    println!("Enter gross weights (g) for each size, space separated. Leave blank if none.\n");

    let gross_110 = read_gross_for_size("110g");
    let gross_227 = read_gross_for_size("227g");
    let gross_450 = read_gross_for_size("450g");

    let input = GrossInput {
        msr_110: gross_110,
        msr_227: gross_227,
        msr_450: gross_450,
    };

    let mut cans = match build_cans_from_gross(&input) {
        Ok(cans) => cans,
        Err(err) => {
            eprintln!("Invalid input: {err}");
            std::process::exit(1);
        }
    };

    if cans.is_empty() {
        eprintln!("No cans provided, exiting.");
        return;
    }

    assign_ids(&mut cans);
    let total = total_fuel(&cans);
    println!("Detected total fuel: {} g across {} cans.", total, cans.len());

    let plan = match solve_plan(&cans) {
        Ok(plan) => plan,
        Err(err) => {
            eprintln!("Solver failed: {err}");
            std::process::exit(1);
        }
    };

    let output = format_plan(&cans, &plan);
    println!("{output}");
}

fn read_line(prompt: &str) -> io::Result<String> {
    print!("{prompt}");
    io::stdout().flush()?;
    let mut buf = String::new();
    io::stdin().read_line(&mut buf)?;
    Ok(buf.trim().to_string())
}

fn read_gross_for_size(prompt_label: &str) -> Vec<i32> {
    let line = read_line(&format!("Gross weights for {} cans: ", prompt_label))
        .expect("failed to read stdin");
    if line.trim().is_empty() {
        return Vec::new();
    }

    line.split_whitespace()
        .map(|raw| {
            raw.parse::<i32>()
                .unwrap_or_else(|_| panic!("invalid integer weight: {raw}"))
        })
        .collect()
}
