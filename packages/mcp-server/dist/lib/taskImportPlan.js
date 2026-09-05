/**
 * `task_import`（CSV 一括取り込み）の純粋ロジック。
 *
 * DB を一切触らない層に「CSV → 正規化行 → 作成計画」を閉じ込め、ハンドラ(tools/taskImport.ts)は
 * 「DBから引いた既存タスク/メンバー/マイルストーンを Map で渡す → 計画どおりに insert する」
 * だけにする。CSV の解釈ルール（見出しの別名・日本語の値・親子の解決・重複の扱い）はすべて
 * ここにあり、taskImportPlan.test.ts が仕様書を兼ねる。
 *
 * 取り込みの契約:
 *   - 1行でもエラーがあれば全体を作らない（半端に取り込まれる方が後始末が高くつく）
 *   - スペースに同じタイトルのタスクが既にあれば作らずスキップ（再実行しても二重に増えない）
 *   - parent 列は「タイトル」で親を指す。CSV内の行 → スペースの既存タスク → 無ければ自動作成
 */
import { parseCsv } from './csv.js';
export const MAX_IMPORT_ROWS = 500;
/** DB トリガー(20260310_000_multi_level_hierarchy.sql)の max_depth と同じ値 */
export const MAX_DEPTH = 10;
const HEADER_ALIASES = {
    title: 'title', タイトル: 'title', タスク: 'title', 件名: 'title',
    description: 'description', 説明: 'description', 詳細: 'description',
    status: 'status', ステータス: 'status', 状態: 'status',
    ball: 'ball', ボール: 'ball',
    origin: 'origin', 起案元: 'origin', 起案: 'origin',
    client_scope: 'client_scope', 公開範囲: 'client_scope', 可視性: 'client_scope',
    start_date: 'start_date', 開始日: 'start_date', 開始: 'start_date',
    due_date: 'due_date', 期限: 'due_date', 期日: 'due_date', 締切: 'due_date',
    assignee: 'assignee', 担当者: 'assignee', 担当: 'assignee', 主担当: 'assignee',
    client_owners: 'client_owners', 相手先担当: 'client_owners', クライアント担当: 'client_owners',
    internal_owners: 'internal_owners', 社内担当: 'internal_owners', 関係者: 'internal_owners',
    parent: 'parent', 親タスク: 'parent', 親: 'parent', 大項目: 'parent',
    priority: 'priority', 優先度: 'priority',
    milestone: 'milestone', マイルストーン: 'milestone',
};
const STATUS_ALIASES = {
    backlog: 'backlog', 未整理: 'backlog', 保留: 'backlog',
    todo: 'todo', 未着手: 'todo',
    in_progress: 'in_progress', 進行中: 'in_progress', 対応中: 'in_progress', 作業中: 'in_progress',
    in_review: 'in_review', 確認待ち: 'in_review', レビュー中: 'in_review', 承認待ち: 'in_review',
    done: 'done', 完了: 'done',
    considering: 'considering', 検討中: 'considering', 提案中: 'considering',
};
const SIDE_ALIASES = {
    client: 'client', 相手先: 'client', クライアント: 'client', 顧客: 'client',
    internal: 'internal', 社内: 'internal', 自社: 'internal',
};
const SCOPE_ALIASES = {
    deliverable: 'deliverable', 公開: 'deliverable', 表示: 'deliverable', 相手先に見せる: 'deliverable',
    internal: 'internal', 非公開: 'internal', 社内: 'internal', 社内のみ: 'internal',
};
const PEOPLE_SEPARATOR = /[;,、・／/|]/;
function normalizeKey(raw) {
    return raw.trim().replace(/\s+/g, '').toLowerCase();
}
function lookupAlias(table, raw) {
    const key = normalizeKey(raw);
    // 英語キーは小文字化した表で、日本語はそのまま照合する
    for (const [alias, value] of Object.entries(table)) {
        if (normalizeKey(alias) === key)
            return value;
    }
    return undefined;
}
/** 'YYYY-MM-DD' / 'YYYY/M/D' を 'YYYY-MM-DD' に正規化。妥当な暦日でなければ null。 */
export function normalizeDate(raw) {
    const m = raw.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!m)
        return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31)
        return null;
    // Date.UTC で暦日として実在するか（2月30日などを弾く）。toISOString は使わず手で組む
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
        return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function splitPeople(raw) {
    return raw
        .split(PEOPLE_SEPARATOR)
        .map((s) => s.trim())
        .filter((s) => s !== '' && s !== '-');
}
/** CSV テキストを正規化した行に変換する。値の不正は行番号つきで errors に積む。 */
export function parseTaskImportCsv(text) {
    const errors = [];
    let records;
    try {
        records = parseCsv(text);
    }
    catch (e) {
        return { rows: [], ignoredColumns: [], errors: [{ line: 1, message: e instanceof Error ? e.message : String(e) }] };
    }
    if (records.length === 0) {
        return { rows: [], ignoredColumns: [], errors: [{ line: 1, message: 'CSVが空です（ヘッダー行が必要です）' }] };
    }
    const [header, ...body] = records;
    const columns = [];
    const ignoredColumns = [];
    const seen = new Set();
    header.cells.forEach((cell) => {
        const col = cell.trim() === '' ? undefined : lookupAlias(HEADER_ALIASES, cell);
        if (!col || seen.has(col)) {
            if (cell.trim() !== '')
                ignoredColumns.push(cell.trim());
            columns.push(null);
            return;
        }
        seen.add(col);
        columns.push(col);
    });
    if (!seen.has('title')) {
        return { rows: [], ignoredColumns, errors: [{ line: 1, message: 'title（タイトル/タスク）列が見つかりません' }] };
    }
    if (body.length > MAX_IMPORT_ROWS) {
        return { rows: [], ignoredColumns, errors: [{ line: 1, message: `一度に取り込めるのは${MAX_IMPORT_ROWS}行までです（${body.length}行）` }] };
    }
    const rows = [];
    for (const rec of body) {
        const get = (col) => {
            const idx = columns.indexOf(col);
            return idx >= 0 ? (rec.cells[idx] ?? '').trim() : '';
        };
        const title = get('title');
        const rowErrors = [];
        const fail = (msg) => rowErrors.push(msg);
        if (title === '')
            fail('title（タイトル）が空です');
        const enumField = (col, table) => {
            const raw = get(col);
            if (raw === '' || raw === '-')
                return null;
            const v = lookupAlias(table, raw);
            if (v === undefined)
                fail(`${col} の値「${raw}」は使えません（${[...new Set(Object.values(table))].join(' | ')}）`);
            return v ?? null;
        };
        const dateField = (col) => {
            const raw = get(col);
            if (raw === '' || raw === '-')
                return null;
            const v = normalizeDate(raw);
            if (v === null)
                fail(`${col} の値「${raw}」は日付として読めません（YYYY-MM-DD）`);
            return v;
        };
        const status = enumField('status', STATUS_ALIASES);
        const ball = enumField('ball', SIDE_ALIASES);
        const origin = enumField('origin', SIDE_ALIASES);
        const clientScope = enumField('client_scope', SCOPE_ALIASES);
        const startDate = dateField('start_date');
        const dueDate = dateField('due_date');
        if (startDate && dueDate && startDate > dueDate)
            fail(`start_date(${startDate}) が due_date(${dueDate}) より後です`);
        let priority = null;
        const rawPriority = get('priority');
        if (rawPriority !== '' && rawPriority !== '-') {
            const n = Number(rawPriority);
            if (!Number.isInteger(n) || n < 0 || n > 3)
                fail(`priority の値「${rawPriority}」は 0〜3 の整数にしてください`);
            else
                priority = n;
        }
        const assigneeRaw = get('assignee');
        const parentRaw = get('parent');
        const milestoneRaw = get('milestone');
        if (rowErrors.length > 0) {
            for (const message of rowErrors)
                errors.push({ line: rec.line, title: title || undefined, message });
            continue;
        }
        rows.push({
            line: rec.line,
            title,
            description: get('description'),
            status, ball, origin, clientScope, startDate, dueDate,
            assignee: assigneeRaw === '' || assigneeRaw === '-' ? null : assigneeRaw,
            clientOwners: splitPeople(get('client_owners')),
            internalOwners: splitPeople(get('internal_owners')),
            parent: parentRaw === '' || parentRaw === '-' ? null : parentRaw,
            priority,
            milestone: milestoneRaw === '' || milestoneRaw === '-' ? null : milestoneRaw,
        });
    }
    return { rows, ignoredColumns, errors };
}
function resolveUser(ref, users) {
    const trimmed = ref.trim();
    if (trimmed.includes('@')) {
        const id = users.byEmail.get(trimmed.toLowerCase());
        return id ? { id } : { error: `担当者「${trimmed}」はこの組織のメンバーに見つかりません` };
    }
    const ids = users.byName.get(trimmed) ?? [];
    if (ids.length === 0)
        return { error: `担当者「${trimmed}」はこの組織のメンバーに見つかりません（メールアドレスでも指定できます）` };
    if (ids.length > 1)
        return { error: `担当者「${trimmed}」と同じ表示名のメンバーが複数います。メールアドレスで指定してください` };
    return { id: ids[0] };
}
export function planTaskImport(input) {
    const errors = [];
    const skipped = [];
    const errorLines = new Set();
    const fail = (row, message) => {
        errors.push({ line: row.line, title: row.title, message });
        errorLines.add(row.line);
    };
    // 1) タイトルの重複（CSV内）と既存タスクとの重複（スキップ）
    const seenTitles = new Set();
    const active = []; // 作成対象として残った行
    for (const row of input.rows) {
        if (seenTitles.has(row.title)) {
            fail(row, `タイトル「${row.title}」がCSV内で重複しています`);
            continue;
        }
        seenTitles.add(row.title);
        if (input.existingTasks.has(row.title)) {
            skipped.push({ line: row.line, title: row.title, reason: '同じタイトルのタスクが既にあります' });
            continue;
        }
        active.push(row);
    }
    // 2) 人・マイルストーンの解決（行単位で独立に検証できるものを先に）
    const resolved = new Map();
    for (const row of active) {
        let assigneeId = null;
        if (row.assignee) {
            const r = resolveUser(row.assignee, input.users);
            if ('error' in r)
                fail(row, r.error);
            else
                assigneeId = r.id;
        }
        const owners = (refs) => {
            const ids = [];
            for (const ref of refs) {
                const r = resolveUser(ref, input.users);
                if ('error' in r)
                    fail(row, r.error);
                else if (!ids.includes(r.id))
                    ids.push(r.id);
            }
            return ids;
        };
        const clientOwnerIds = owners(row.clientOwners);
        const internalOwnerIds = owners(row.internalOwners);
        if (row.ball === 'client' && row.clientOwners.length === 0) {
            fail(row, 'ball=client の行には client_owners（相手先担当）が必要です');
        }
        let milestoneId = null;
        if (row.milestone) {
            const id = input.milestones.get(row.milestone);
            if (!id)
                fail(row, `マイルストーン「${row.milestone}」がこのスペースにありません`);
            else
                milestoneId = id;
        }
        resolved.set(row.line, { assigneeId, clientOwnerIds, internalOwnerIds, milestoneId });
    }
    // 3) 親の解決。parent は「タイトル」で指す
    const rowByTitle = new Map(active.map((r) => [r.title, r]));
    const autoParents = new Map();
    const parentOf = new Map();
    for (const row of active) {
        if (!row.parent)
            continue;
        if (row.parent === row.title) {
            fail(row, '自分自身を親タスクにはできません');
            continue;
        }
        const inCsv = rowByTitle.get(row.parent);
        if (inCsv) {
            parentOf.set(row.line, { kind: 'row', row: inCsv });
            continue;
        }
        const existingId = input.existingTasks.get(row.parent);
        if (existingId) {
            parentOf.set(row.line, { kind: 'existing', id: existingId });
            continue;
        }
        if (!autoParents.has(row.parent))
            autoParents.set(row.parent, { id: input.newId(), anyDeliverable: false });
        if (row.clientScope === 'deliverable')
            autoParents.get(row.parent).anyDeliverable = true;
        parentOf.set(row.line, { kind: 'auto', title: row.parent });
    }
    // 4) 深さと循環。CSV内の親の連鎖をたどる
    const depthOf = new Map();
    const depthFor = (row, trail) => {
        if (depthOf.has(row.line))
            return depthOf.get(row.line);
        const ref = parentOf.get(row.line);
        let d;
        if (!ref)
            d = 0;
        else if (ref.kind === 'existing')
            d = 1; // 既存側の深さは分からない。DBトリガーが最終防衛
        else if (ref.kind === 'auto')
            d = 1;
        else {
            if (trail.has(ref.row.line))
                return 'cycle';
            trail.add(row.line);
            const pd = depthFor(ref.row, trail);
            if (pd === 'cycle')
                return 'cycle';
            d = pd + 1;
        }
        depthOf.set(row.line, d);
        return d;
    };
    for (const row of active) {
        if (errorLines.has(row.line))
            continue;
        const d = depthFor(row, new Set([row.line]));
        if (d === 'cycle') {
            fail(row, `親タスクの指定が循環しています（${row.title} → ${row.parent}）`);
        }
        else if (d > MAX_DEPTH) {
            fail(row, `階層が深すぎます（最大${MAX_DEPTH}段）`);
        }
    }
    if (errors.length > 0) {
        return { tasks: [], autoParents: [], skipped, errors };
    }
    // 5) 計画を組み立てる（id 採番は行順で決定的に）
    const ids = new Map();
    for (const row of active)
        ids.set(row.line, input.newId());
    const tasks = [];
    for (const [title, meta] of autoParents) {
        tasks.push({
            id: meta.id, line: null, title, description: '',
            status: 'todo', ball: 'internal', origin: 'internal',
            clientScope: meta.anyDeliverable ? 'deliverable' : 'internal',
            startDate: null, dueDate: null, assigneeId: null, parentId: null,
            priority: null, milestoneId: null, clientOwnerIds: [], internalOwnerIds: [],
            depth: 0, autoParent: true,
        });
    }
    for (const row of active) {
        const r = resolved.get(row.line);
        const ref = parentOf.get(row.line);
        let parentId = null;
        if (ref?.kind === 'row')
            parentId = ids.get(ref.row.line);
        else if (ref?.kind === 'existing')
            parentId = ref.id;
        else if (ref?.kind === 'auto')
            parentId = autoParents.get(ref.title).id;
        tasks.push({
            id: ids.get(row.line),
            line: row.line,
            title: row.title,
            description: row.description,
            status: row.status ?? 'todo',
            ball: row.ball ?? 'internal',
            origin: row.origin ?? 'internal',
            clientScope: row.clientScope ?? 'internal',
            startDate: row.startDate,
            dueDate: row.dueDate,
            assigneeId: r.assigneeId,
            parentId,
            priority: row.priority,
            milestoneId: r.milestoneId,
            clientOwnerIds: r.clientOwnerIds,
            internalOwnerIds: r.internalOwnerIds,
            depth: depthOf.get(row.line) ?? 0,
            autoParent: false,
        });
    }
    // 親が必ず先に insert されるよう depth 昇順（安定ソート＝同じ深さは元の順）
    tasks.sort((a, b) => a.depth - b.depth);
    return { tasks, autoParents: [...autoParents.keys()], skipped, errors };
}
//# sourceMappingURL=taskImportPlan.js.map