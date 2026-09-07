/**
 * サーバーのコマンド一覧(manifest)に添えられた「お知らせ」を、まだ見ていない分だけ 1 回表示する。
 * 見た分の id は ~/.agentpm/notices.seen.json に残す。表示は stderr に出し、--json の stdout を汚さない。
 *
 * 「一度だけ確実に見せる」ための決まり:
 * - stderr が端末につながっていない(cron・リダイレクト)ときは出さず、既読にもしない
 * - 一度に出すのは新しい方から MAX_SHOWN 件。残りは「ほか N 件」にまとめ、まとめて既読にする
 * - 記録の読み書きに失敗しても落ちない(次回また出るだけ)
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
const SEEN_PATH = join(homedir(), '.agentpm', 'notices.seen.json');
/** 覚えておく id の上限(古いものから捨てる)。サーバーが配る件数(≤20)より十分大きくしておく */
const MAX_SEEN = 200;
/** 一度に表示する上限 */
export const MAX_SHOWN = 5;
/** 日付の無いお知らせは「最新」として並べる(manifest-validator と同じ扱い) */
const NO_DATE = '9999-99-99';
/** 既読 id をファイルに残す store。path を差し替えてテストできる */
export function createFileNoticeStore(path) {
    return {
        readSeen() {
            if (!existsSync(path))
                return [];
            // 壊れた JSON はここで例外 → 呼び出し側が握って全件未読として扱う
            const parsed = JSON.parse(readFileSync(path, 'utf-8'));
            return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
        },
        writeSeen(ids) {
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
            const tmp = `${path}.${process.pid}.tmp`;
            writeFileSync(tmp, JSON.stringify(ids), { mode: 0o600 });
            renameSync(tmp, path);
        },
    };
}
export const fileNoticeStore = createFileNoticeStore(SEEN_PATH);
/** argv から最初のコマンド名(- で始まらない最初の語)を取り出す。`agentpm -s <uuid> update` でも 'update' */
export function firstCommandName(argv) {
    const args = argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (!a.startsWith('-'))
            return a;
        // 値を取るグローバルオプションは次の語を飛ばす
        if (a === '-s' || a === '--space-id' || a === '--api-key')
            i++;
    }
    return undefined;
}
/** 通常実行でお知らせを出してよいか: 端末につながっていて、--json でないとき */
export function shouldShowNotices(argv, stderrIsTty) {
    return stderrIsTty && !argv.includes('--json');
}
/** まだ見ていないお知らせを、日付順(古い→新しい)で返す。同じ id が重複していれば最初の1件だけ */
export function pickUnseen(notices, seen) {
    if (!notices?.length)
        return [];
    const skip = new Set(seen);
    const out = [];
    notices.forEach((n, i) => {
        if (skip.has(n.id))
            return;
        skip.add(n.id);
        out.push({ n, i });
    });
    return out
        .sort((a, b) => (a.n.date ?? NO_DATE).localeCompare(b.n.date ?? NO_DATE) || a.i - b.i)
        .map(({ n }) => n);
}
export function formatNotices(notices, hiddenCount = 0) {
    const lines = notices.map((n) => `  - ${n.date ? `[${n.date}] ` : ''}${n.message}`);
    if (hiddenCount > 0)
        lines.push(chalk.gray(`  （ほか ${hiddenCount} 件の古いお知らせがあります）`));
    return [chalk.cyan('📣 AgentPM からのお知らせ'), ...lines, ''].join('\n');
}
/** 未読のお知らせを表示して既読にする。表示した件数を返す。記録の失敗では落ちない */
export function showNewNotices(manifest, deps = { store: fileNoticeStore, print: (t) => console.error(t) }) {
    let seen = [];
    try {
        seen = deps.store.readSeen();
    }
    catch {
        /* 読めなければ全部未読として扱う */
    }
    const unseen = pickUnseen(manifest.notices, seen);
    if (unseen.length === 0)
        return 0;
    // 新しい方から MAX_SHOWN 件だけ出す(pickUnseen は古い→新しい順)
    const shown = unseen.slice(-MAX_SHOWN);
    deps.print(formatNotices(shown, unseen.length - shown.length));
    try {
        // 出さなかった古い分も既読にする(次回また「ほか N 件」と出続けないように)。重複は潰す
        const next = [...new Set([...seen, ...unseen.map((n) => n.id)])];
        deps.store.writeSeen(next.slice(-MAX_SEEN));
    }
    catch {
        /* 記録できなくても次回また出るだけ */
    }
    return shown.length;
}
//# sourceMappingURL=notices.js.map