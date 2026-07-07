import { isNewFiling, newCount } from './newFilings';

function check(name: string, cond: boolean) {
    if (!cond) throw new Error(`FAIL: ${name}`);
    console.log(`ok - ${name}`);
}

check('newer than watermark → new', isNewFiling('2026-05-01', '2026-03-28'));
check('older/equal → not new', !isNewFiling('2026-03-28', '2026-03-28') && !isNewFiling('2026-01-01', '2026-03-28'));
check('no watermark (first visit) → not new', !isNewFiling('2026-05-01', null));
check('null filing date → not new', !isNewFiling(null, '2026-03-28'));
check('newCount counts only newer', newCount(['2026-05-01', '2026-04-30', '2026-03-01'], '2026-04-01') === 2);
check('newCount first visit → 0', newCount(['2026-05-01', '2026-04-30'], null) === 0);

console.log('\nAll newFilings checks passed.');
