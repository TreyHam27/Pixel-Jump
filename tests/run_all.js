// Runs every tests/test_*.js in its own node process and reports each one's
// real exit code (piping through `tail` in a shell loop hides failures).
//   node tests/run_all.js            # everything
//   node tests/run_all.js boss perk  # only files whose name contains a filter
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TIMEOUT_MS = 180000;
const filters = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
    .filter(f => /^test_.*\.js$/.test(f) && f !== 'test_helpers.js')
    .filter(f => !filters.length || filters.some(s => f.includes(s)))
    .sort();

function runOne(file) {
    return new Promise(resolve => {
        const started = Date.now();
        const child = spawn(process.execPath, [path.join(__dirname, file)], { cwd: path.join(__dirname, '..') });
        let output = '';
        child.stdout.on('data', d => { output += d; });
        child.stderr.on('data', d => { output += d; });
        const timer = setTimeout(() => { output += '\n[run_all] timed out'; child.kill('SIGKILL'); }, TIMEOUT_MS);
        child.on('close', code => {
            clearTimeout(timer);
            resolve({ file, ok: code === 0, ms: Date.now() - started, output });
        });
    });
}

(async () => {
    const queue = [...files];
    const results = [];
    const workers = Array.from({ length: Math.min(os.cpus().length, 4) }, async () => {
        while (queue.length) {
            const r = await runOne(queue.shift());
            results.push(r);
            console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}  (${(r.ms / 1000).toFixed(1)}s)`);
        }
    });
    await Promise.all(workers);

    const failed = results.filter(r => !r.ok);
    for (const r of failed) {
        console.log(`\n----- ${r.file} output (last 40 lines) -----`);
        console.log(r.output.trim().split('\n').slice(-40).join('\n'));
    }
    console.log(`\n${results.length - failed.length}/${results.length} test files passed`);
    process.exitCode = failed.length ? 1 : 0;
})();
