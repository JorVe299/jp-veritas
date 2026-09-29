// Comment policy guard (BACKEND.md §1): block length and line width for every source file
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const MAX_LINES = 3;
const MAX_WIDTH = 100;

const ROOTS = [
    'backend', 'deploy', 'veritas', '.gitignore',
    'frontend/src', 'frontend/index.html', 'frontend/vite.config.js',
    'frontend/eslint.config.js', 'frontend/.gitignore',
];
const SKIP_DIRS = new Set(['node_modules', 'data', 'dist']);
// Server-local copy of config.lua.example; gitignored
const SKIP_FILES = new Set(['veritas/config.lua']);

const SYNTAX = [
    [/\.(c|m)?jsx?$/, { line: '//', blocks: [['{/*', '*/'], ['/*', '*/']] }],
    [/\.css$/, { blocks: [['/*', '*/']] }],
    [/(\.lua|config\.lua\.example)$/, { line: '--', blocks: [['--[[', ']]']] }],
    [/(\.sh|\.env\.example|\.gitignore)$/, { line: '#' }],
    [/\.html$/, { blocks: [['<!--', '-->']] }],
];

const syntaxOf = (file) => (SYNTAX.find(([re]) => re.test(file)) || [])[1] || null;

function walk(rel) {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) return [];
    if (!fs.statSync(abs).isDirectory()) return [rel];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap(entry => {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) return [];
        return walk(path.posix.join(rel, entry.name));
    });
}

/** Comment blocks as { at, lines }: runs of line comments, or one block comment */
function commentBlocks(source, syntax) {
    const blocks = [];
    let run = null;
    let open = null;
    const lines = source.split(/\r?\n/);
    const endRun = () => {
        if (run) blocks.push(run);
        run = null;
    };

    lines.forEach((raw, i) => {
        const line = raw.replace(/\s+$/, '');
        const text = line.trim();
        if (open) {
            open.lines.push(line);
            if (text.includes(open.close)) {
                blocks.push(open);
                open = null;
            }
            return;
        }
        const opener = (syntax.blocks || []).find(([start]) => text.startsWith(start));
        if (opener) {
            endRun();
            const block = { at: i + 1, lines: [line], close: opener[1] };
            if (text.indexOf(opener[1], opener[0].length) === -1) open = block;
            else blocks.push(block);
            return;
        }
        if (syntax.line && text.startsWith(syntax.line) && !text.startsWith('#!')) {
            if (!run) run = { at: i + 1, lines: [] };
            run.lines.push(line);
            return;
        }
        endRun();
    });
    endRun();
    if (open) blocks.push(open);
    return blocks;
}

const DECORATION = /^[-=*#~\s]*$/;
const SECTION_MARKER = /^[-=]{3} .+ [-=]{3,}$/;

/** Lines that carry text: no delimiters, decoration, section markers or doc tags */
function contentLines(block) {
    return block.lines
        .map(line => line.trim()
            .replace(/(\*\/\}?|\]\]|-->)$/, '')
            .replace(/^(\{\/\*+|\/\*+|\/\/+|--\[\[|-{2,}|#|<!--|\*)/, '')
            .trim())
        .filter(text => text && !DECORATION.test(text) && !SECTION_MARKER.test(text) && !text.startsWith('@'));
}

function violations(file, source) {
    const syntax = syntaxOf(file);
    if (!syntax) return { long: [], wide: [] };
    const blocks = commentBlocks(source, syntax);
    return {
        long: blocks
            .filter(b => contentLines(b).length > MAX_LINES)
            .map(b => `${file}:${b.at} (${contentLines(b).length} lines)`),
        wide: blocks.flatMap(b => b.lines
            .map((line, k) => ({ line, n: b.at + k }))
            .filter(({ line }) => line.length > MAX_WIDTH)
            .map(({ line, n }) => `${file}:${n} (${line.length} columns)`)),
    };
}

const files = ROOTS.flatMap(walk).filter(f => syntaxOf(f) && !SKIP_FILES.has(f));
const found = files.map(f => violations(f, fs.readFileSync(path.join(REPO, f), 'utf8')));

test('the scan covers the repo', () => {
    assert.ok(files.length > 100, `only ${files.length} source files found`);
    for (const ext of ['.js', '.jsx', '.css', '.lua', '.sh']) {
        assert.ok(files.some(f => f.endsWith(ext)), `no ${ext} file scanned`);
    }
});

test('the scanner flags an over-long block in every syntax', () => {
    const samples = {
        'a.js': 'x();\n// 1\n// 2\n// 3\n// 4\ny();',
        'a.jsx': '<div>\n{/* 1\n 2\n 3\n 4 */}\n</div>',
        'b.js': '/**\n * 1\n * 2\n * @param x\n * 3\n * 4\n */\nfunction f(x) {}',
        'a.css': '/* 1\n 2\n 3\n 4 */\na {}',
        'a.lua': '-- 1\n-- 2\n-- 3\n-- 4\nlocal x = 1',
        'b.lua': '---@class A\n-- 1\n-- 2\n---@field x number\n-- 3\n-- 4\nA = {}',
        'a.sh': '#!/bin/sh\n# 1\n# 2\n# 3\n# 4\ntrue',
        'a.html': '<!-- 1\n 2\n 3\n 4 -->',
    };
    for (const [file, source] of Object.entries(samples)) {
        assert.equal(violations(file, source).long.length, 1, file);
        assert.equal(violations(file, source.replace(/\n.*4/, '')).long.length, 0, `${file} at the limit`);
    }
});

test(`comment blocks are at most ${MAX_LINES} lines`, () => {
    assert.deepStrictEqual(found.flatMap(v => v.long), []);
});

test(`comment lines are at most ${MAX_WIDTH} columns`, () => {
    assert.deepStrictEqual(found.flatMap(v => v.wide), []);
});
