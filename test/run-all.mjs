import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

// npm run always executes from the root directory where package.json is located
const packageJsonPath = path.resolve(process.cwd(), 'package.json');

if (!fs.existsSync(packageJsonPath)) {
    console.error('Error: package.json not found.');
    process.exit(1);
}

// Read and parse package.json
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Filter for any scripts starting with "test:" (excluding the main "test" script itself)
const testScripts = Object.keys(pkg.scripts || {})
    .filter(key => key.startsWith('test:'));

if (testScripts.length === 0) {
    console.log('No scripts starting with "test:" were found in package.json.');
    process.exit(0);
}

// Capture arguments passed from command line (e.g., the world.db file path)
const args = process.argv.slice(2);

for (const scriptName of testScripts) {
    const commandString = pkg.scripts[scriptName];
    console.log(`\n--- Running ${scriptName} ---`);

    // Split the command (e.g., "node test/file.mjs") into executable and internal args
    const commandParts = commandString.trim().split(/\s+/);
    const executable = commandParts[0];
    const internalArgs = commandParts.slice(1);

    // Combine the script's internal arguments with your CLI arguments
    const finalArgs = [...internalArgs, ...args];

    // Spawn the process directly without shell wrapper to avoid space-quoting issues
    const result = spawnSync(executable, finalArgs, { stdio: 'inherit' });

    // Stop running and exit immediately if any test fails
    if (result.status !== 0) {
        console.error(`\nFAIL: ${scriptName} failed with exit code ${result.status}`);
        process.exit(result.status ?? 1);
    }
}

console.log('\nAll tests passed.');
