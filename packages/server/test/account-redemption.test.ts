import assert from 'node:assert/strict';
import test from 'node:test';
import { accountFlows, sha256url, type IdentityStore } from '../src/account/flows.ts';

const code = 'c'.repeat(43);
const verifier = 'v'.repeat(43);
const identity = { provider: 'google', subject: 'fixture-subject' } as const;

function prepared(store: Partial<IdentityStore>, link = true) {
  let time = 0;
  const flows = accountFlows({}, {
    account: async token => token === 'owner' ? { id: 'owner', name: 'Guest' } : undefined,
    providers: async () => [], ownerOf: async () => undefined,
    link: async () => assert.fail('unexpected link'), restore: async () => assert.fail('unexpected restore'),
    ...store,
  }, () => time, {
    pending: new Map(),
    verified: new Map([[code, { owner: 'owner', link, identity, deadline: 50, challenge: sha256url(verifier) }]]),
  });
  return { flows, expire: () => { time = 50; }, redeem: () => flows.redeem({ code, verifier }, link ? 'owner' : undefined) };
}

test('admitted redemption reports the definitive storage result after its deadline', async () => {
  const session = { token: 'fixture-session', name: 'Guest' };
  for (const outcome of ['link', 'restore', 'refused'] as const) {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let dispatched = 0;
    const write = async () => { dispatched++; started.resolve(); await finish.promise; };
    const f = prepared({
      link: async id => { assert.equal(id, 'owner'); await write(); return outcome === 'link'; },
      restore: async () => { await write(); return session; },
    }, outcome !== 'restore');
    const redemption = f.redeem();
    await started.promise;
    assert.equal(await f.redeem(), undefined);
    f.expire();
    finish.resolve();
    assert.deepEqual(await redemption, { link: { linked: true }, restore: session, refused: undefined }[outcome]);
    assert.equal(await f.redeem(), undefined);
    assert.equal(dispatched, 1);
  }
});

test('deadline and current owner must still hold when dispatch starts', async () => {
  const f = prepared({});
  assert.equal(await f.flows.redeem({ code, verifier: 'w'.repeat(43) }, 'owner'), undefined);
  assert.equal(await f.flows.redeem({ code, verifier }, 'other'), undefined);
  f.expire();
  assert.equal(await f.redeem(), undefined);

  const owner = Promise.withResolvers<{ id: string; name: string }>();
  const checking = prepared({ account: () => owner.promise });
  const redemption = checking.redeem();
  checking.expire();
  owner.resolve({ id: 'owner', name: 'Guest' });
  assert.equal(await redemption, undefined);
});

test('erasure and closure cancel admitted redemption independently of its deadline', async () => {
  for (const cancel of ['erase', 'close'] as const) {
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<boolean>();
    const f = prepared({ link: () => { started.resolve(); return finish.promise; } });
    const redemption = f.redeem();
    await started.promise;
    f.flows[cancel]('owner');
    finish.resolve(true);
    assert.equal(await redemption, undefined);
  }
});