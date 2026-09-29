// Invariants over examples: a too-generous rule looks correct in daily use
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const perms = require('./permissions');

test('the owner has every capability without exception', () => {
    for (const cap of perms.CAPABILITY_IDS) {
        assert.ok(perms.can('owner', cap), `owner is missing ${cap}`);
    }
    assert.ok(perms.can('owner', perms.OWNER_ONLY));
});

test('handing out permissions stays reserved for the owner', () => {
    for (const role of perms.roleIds()) {
        if (role === 'owner') continue;
        assert.equal(perms.can(role, perms.OWNER_ONLY), false,
            `${role} must not hand out permissions`);
    }
});

test('permissions.edit is not in the grantable list', () => {
    // Grantable = removable in the UI, which would lock everyone out of permissions
    assert.equal(perms.CAPABILITY_IDS.includes(perms.OWNER_ONLY), false);
});

test('an unknown role may do nothing at all', () => {
    for (const cap of perms.CAPABILITY_IDS) {
        assert.equal(perms.can('janitor', cap), false);
    }
});

test('every default refers to a capability that exists', () => {
    const known = new Set([...perms.CAPABILITY_IDS, perms.OWNER_ONLY]);
    // Checks the defaults, not the live list: runtime-created roles have no default
    for (const cap of Object.values(perms.DEFAULTS).flat()) {
        assert.ok(known.has(cap), `default names an unknown capability: ${cap}`);
    }
});

test('defaults are tiered: a citizen may change nothing', () => {
    const edits = perms.DEFAULTS.citizen.filter(c => c.endsWith('.edit') || c === 'actions.live');
    assert.deepEqual(edits, [], 'citizen is a read-only role');
});

test('a supporter may not touch money or accounts', () => {
    for (const cap of ['money.edit', 'accounts.edit', 'bans.edit']) {
        assert.equal(perms.DEFAULTS.supporter.includes(cap), false,
            `supporter should not have ${cap} by default`);
    }
});

// Route coverage guard: a new route without a rule fails here, not in production (BACKEND.md §4)
test('every registered route has a permission rule', () => {
    const dir = path.join(__dirname, '../routes');
    const registered = [];

    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(dir, file), 'utf8');
        const re = /router\.(get|post|put|patch|delete)\('([^']+)'/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            registered.push({ method: m[1].toUpperCase(), route: m[2], file });
        }
    }

    assert.ok(registered.length > 20, 'the routes were not found');

    const withoutRule = registered.filter(({ method, route }) => {
        // Sign-in runs without a role
        if (route.startsWith('/api/auth/')) return false;
        // Portal: ownership instead of a role; the exemption test below proves it narrow
        if (route === perms.SELF_PREFIX || route.startsWith(perms.SELF_PREFIX + '/')) return false;
        // Replace :param with a sample value so the regex can match
        const sample = route.replace(/:[^/]+/g, 'SAMPLE');
        return perms.requiredFor(method, sample) === null;
    });

    assert.deepEqual(
        withoutRule.map(r => `${r.method} ${r.route} (${r.file})`),
        [],
        'these routes have no rule in RULES'
    );
});

test('conversely, the rules do match something', () => {
    // Stale rules for deleted routes fake coverage
    const dir = path.join(__dirname, '../routes');
    const samples = [];
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(dir, file), 'utf8');
        const re = /router\.(get|post|put|patch|delete)\('([^']+)'/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            samples.push({ method: m[1].toUpperCase(), path: m[2].replace(/:[^/]+/g, 'SAMPLE') });
        }
    }

    const matched = new Set();
    for (const s of samples) {
        const cap = perms.requiredFor(s.method, s.path);
        if (cap) matched.add(`${s.method} ${cap}`);
    }
    assert.ok(matched.size > 15, 'the rules barely match - are the paths still right?');
});

test('sanitize drops unknown capabilities and tops the owner up', () => {
    // save() would write the file; this checks the sanitising via the public matrix
    const matrix = perms.getMatrix();
    for (const role of perms.roleIds()) {
        for (const cap of matrix[role]) {
            assert.ok(perms.CAPABILITY_IDS.includes(cap),
                `${role} carries unknown capability ${cap}`);
        }
    }
    assert.equal(matrix.owner.length, perms.CAPABILITY_IDS.length);
});

test('capabilitiesOf gives the owner the special capability too', () => {
    assert.ok(perms.capabilitiesOf('owner').includes(perms.OWNER_ONLY));
    assert.equal(perms.capabilitiesOf('administrator').includes(perms.OWNER_ONLY), false);
});

// --- The portal exemption -------------------------------------------------
// /api/me skips role checks (ownership decides); a wider exemption or a role-less
// session falling through would expose the whole admin panel

function run(req) {
    const calls = { next: 0, status: null, body: null };
    const res = {
        status(code) { calls.status = code; return res; },
        json(body) { calls.body = body; return res; },
    };
    perms.enforce(req, res, () => { calls.next += 1; });
    return calls;
}

const citizen = { id: '123', role: null, portal: true };
const admin = { id: '456', role: 'administrator' };

test('a session without a role reaches the portal', () => {
    for (const path of ['/api/me', '/api/me/characters/ABC123', '/api/me/characters/ABC123/vehicles']) {
        const r = run({ path, method: 'GET', user: citizen });
        assert.equal(r.next, 1, `portal route ${path} should pass`);
        assert.equal(r.status, null);
    }
});

test('a session without a role reaches nothing else', () => {
    const paths = [
        ['GET', '/api/players'],
        ['GET', '/api/accounts'],
        ['GET', '/api/system/schema'],
        ['POST', '/api/manage/money'],
        ['POST', '/api/manage/ban'],
        ['PUT', '/api/permissions'],
    ];
    for (const [method, path] of paths) {
        const r = run({ path, method, user: citizen });
        assert.equal(r.next, 0, `${method} ${path} must not pass without a role`);
        assert.equal(r.status, 403, `${method} ${path} should answer 403`);
    }
});

test('the exemption does not leak to lookalike paths', () => {
    // '/api/members' starts with '/api/me' as a string but is not the portal
    for (const path of ['/api/members', '/api/mexico', '/api/me-too']) {
        const r = run({ path, method: 'GET', user: citizen });
        assert.equal(r.next, 0, `${path} must not be treated as the portal`);
    }
});

test('an admin role is still checked by the rules', () => {
    // administrator has accounts.view by default, so this passes...
    assert.equal(run({ path: '/api/accounts', method: 'GET', user: admin }).next, 1);
    // ...while handing out permissions stays with the owner
    assert.equal(run({ path: '/api/permissions', method: 'PUT', user: admin }).status, 403);
});

test('no session at all means auth is off and nothing is enforced', () => {
    assert.equal(run({ path: '/api/players', method: 'GET' }).next, 1);
});
