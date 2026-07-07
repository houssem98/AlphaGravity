import { peersFor } from './peers';

function check(name: string, cond: boolean) {
    if (!cond) throw new Error(`FAIL: ${name}`);
    console.log(`ok - ${name}`);
}

check('excludes self', !peersFor('NVDA').includes('NVDA'));
check('NVDA gets semis peers', peersFor('NVDA').includes('AMD') && peersFor('NVDA').includes('INTC'));
check('case-insensitive', peersFor('nvda').includes('AMD'));
check('caps to limit', peersFor('NVDA', 2).length === 2);
check('unknown ticker → empty', peersFor('ZZZZ').length === 0);

console.log('\nAll peers checks passed.');
