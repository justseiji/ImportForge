import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { fields, fieldLabels, type ImportConfig, type PreviewRow } from '@importforge/contracts';
import { api, client, keys, refreshImport } from '../../lib/api';
import {
  Badge,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  Pagination,
  Table,
  date,
} from '../../components/ui';
import { useSession } from '../../lib/session';
const dictText = (v: Record<string, string>) =>
  Object.entries(v)
    .map(([a, b]) => `${a} = ${b}`)
    .join('\n');
function readDict(text: string) {
  const result: Record<string, string> = {};
  for (const line of text.split('\n').filter((s) => s.trim())) {
    const split = line.indexOf('=');
    if (split < 1) throw new Error('Use one “source = destination” mapping per line.');
    result[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return result;
}
export function ImportWorkspace() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const session = useSession();
  const editable = session.data?.user.role !== 'viewer';
  const query = useQuery({
    queryKey: keys.detail(id),
    queryFn: () => api(`/imports/${id}`),
    refetchInterval: 1000,
  });
  const b = query.data;
  const [tab, setTab] = useState('configure'),
    [draft, setDraft] = useState<ImportConfig>(),
    [draftRevision, setDraftRevision] = useState(0),
    [categories, setCategories] = useState(''),
    [units, setUnits] = useState(''),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState(false),
    [exclude, setExclude] = useState<PreviewRow>(),
    [reason, setReason] = useState(''),
    [consent, setConsent] = useState(false),
    [suggesting, setSuggesting] = useState(false);
  const page = Number(params.get('page') ?? 1),
    kind = params.get('kind') ?? '';
  const rows = useQuery({
    queryKey: [...keys.rows(id), params.toString(), b?.status, b?.revision],
    queryFn: () => api(`/imports/${id}/rows?${params}`),
    enabled: !!b,
  });
  const mappings = useQuery({
    queryKey: ['mappings', b?.supplier_id],
    queryFn: () => api(`/suppliers/${b.supplier_id}/mappings`),
    enabled: !!b,
  });
  useEffect(() => {
    if (b && !dirty) {
      setDraft(b.config);
      setDraftRevision(b.revision);
      setCategories(dictText(b.config.categories));
      setUnits(dictText(b.config.units));
    }
  }, [b?.revision, b?.id, dirty]);
  useEffect(() => {
    if (b?.status === 'review' && !dirty) setTab('review');
    if (b?.status === 'completed') setTab('receipt');
  }, [b?.status]);
  useEffect(() => {
    if (b?.suggestion) setSuggesting(false);
  }, [b?.suggestion?.createdAt]);
  const save = useMutation({
    mutationFn: async (exclusions: Record<string, string>) => {
      if (!draft) return;
      return api(`/imports/${id}/prepare`, {
        expectedRevision: draftRevision,
        config: { ...draft, categories: readDict(categories), units: readDict(units) },
        exclusions,
      });
    },
    onSuccess: () => {
      setDirty(false);
      setExclude(undefined);
      setError(undefined);
      refreshImport(id);
    },
    onError: setError,
  });
  const commit = useMutation({
    mutationFn: () => {
      const key = `importforge:${id}:${b.revision}`;
      return api(`/imports/${id}/commit`, { revision: b.revision, idempotencyKey: key });
    },
    onSuccess: () => {
      setConfirm(false);
      refreshImport(id);
    },
    onError: setError,
  });
  if (query.error) return <ErrorBox error={query.error} />;
  if (!b || !draft) return <Loading />;
  const processing = ['parsing', 'preparing', 'committing'].includes(b.status);
  const canEdit = editable && !processing && b.status !== 'completed';
  function change(patch: Partial<ImportConfig>) {
    setDraft((d) => ({ ...d!, ...patch }));
    setDirty(true);
    setNotice('');
  }
  async function suggestions() {
    setError(undefined);
    setSuggesting(true);
    try {
      await api(`/imports/${id}/suggest`, { consent });
      setNotice(
        'Suggestion request queued. Your current mappings stay unchanged until you accept.',
      );
    } catch (e) {
      setSuggesting(false);
      setError(e);
    }
  }
  async function saveMapping() {
    try {
      await api(`/suppliers/${b.supplier_id}/mappings`, {
        headers: b.headers,
        config: { ...draft, categories: readDict(categories), units: readDict(units) },
      });
      await client.invalidateQueries({ queryKey: ['mappings', b.supplier_id] });
      setNotice('Supplier mapping saved as a new version.');
    } catch (e) {
      setError(e);
    }
  }
  function reuse(mapping: any) {
    if (JSON.stringify(mapping.headers) !== JSON.stringify(b.headers)) {
      setError(
        new Error(
          'Source headers differ from this saved mapping. Review and map the new structure manually.',
        ),
      );
      return;
    }
    change({ ...mapping.config, origin: 'saved' });
    setCategories(dictText(mapping.config.categories));
    setUnits(dictText(mapping.config.units));
    setNotice(`Loaded saved version ${mapping.version}. Review before validating.`);
  }
  return (
    <>
      <Link className="back-link" to="/imports">
        ← All imports
      </Link>
      <div className="import-heading">
        <span className="file-icon large">
          <FileSpreadsheet size={26} />
        </span>
        <div>
          <h1>{b.filename}</h1>
          <p>
            {b.supplier_name} <span>·</span> {b.row_count ?? 'Counting'} source records{' '}
            <span>·</span> Uploaded by {b.owner}
          </p>
        </div>
        <Badge value={b.status} />
      </div>
      <div className="steps">
        {['Upload', 'Map & transform', 'Validate', 'Review changes', 'Receipt'].map((label, i) => {
          const current =
            b.status === 'parsing'
              ? 0
              : b.status === 'mapping'
                ? 1
                : b.status === 'preparing' || b.status === 'failed'
                  ? 2
                  : b.status === 'completed'
                    ? 4
                    : 3;
          return (
            <div className={i === current ? 'current' : i < current ? 'done' : ''} key={label}>
              <span>{i < current ? <Check size={13} /> : i + 1}</span>
              {label}
            </div>
          );
        })}
      </div>
      <ErrorBox error={error || b.error} />
      {notice && (
        <div className="alert info" role="status">
          {notice}
        </div>
      )}
      {processing && (
        <div className="processing" role="status">
          <RefreshCw size={20} />
          <div>
            <strong>
              {b.status === 'parsing'
                ? 'Inspecting your source file'
                : b.status === 'preparing'
                  ? 'Validating and comparing records'
                  : 'Committing your approved changes'}
            </strong>
            <p>
              {b.status === 'committing'
                ? 'You can safely refresh this page. The receipt will appear when the transaction finishes.'
                : 'Progress is saved. You can leave this page and return to this import.'}
            </p>
          </div>
        </div>
      )}
      {b.headers.length > 0 && (
        <>
          <div className="workspace-tabs">
            <button
              className={tab === 'configure' ? 'active' : ''}
              onClick={() => setTab('configure')}
            >
              Mapping & transformations
            </button>
            <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
              Validation & review{' '}
              {b.counts?.blocked > 0 && <span className="tab-count">{b.counts.blocked}</span>}
            </button>
            <button
              disabled={!b.receipt}
              className={tab === 'receipt' ? 'active' : ''}
              onClick={() => setTab('receipt')}
            >
              Receipt
            </button>
            <span className="revision-label">
              Revision {b.revision} {dirty ? '· Unsaved changes' : '· Saved'}
            </span>
          </div>
          {tab === 'configure' && (
            <>
              <section className="surface">
                <div className="section-heading">
                  <div>
                    <h2>Give every column a destination.</h2>
                    <p>Original values stay intact. You decide how they become catalog data.</p>
                  </div>
                  <div className="inline-actions">
                    {mappings.data?.items.length > 0 && (
                      <select
                        aria-label="Reuse supplier mapping"
                        disabled={!canEdit}
                        value=""
                        onChange={(e) =>
                          reuse(mappings.data.items.find((m: any) => m.id === e.target.value))
                        }
                      >
                        <option value="">Reuse saved mapping…</option>
                        {mappings.data.items.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            Version {m.version} · {date(m.created_at)}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className="button secondary"
                      disabled={!canEdit || suggesting}
                      onClick={suggestions}
                    >
                      <Sparkles size={16} />
                      {suggesting ? 'Preparing suggestions…' : 'Suggest mappings'}
                    </button>
                  </div>
                </div>
                <div className="ai-disclosure">
                  <Sparkles size={15} />
                  {session.data?.aiAvailable ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      Allow sending headers and up to five bounded sample records to the configured
                      AI provider.
                    </label>
                  ) : (
                    <span>Deterministic suggestion mode · no data is sent to an AI provider.</span>
                  )}
                </div>
                {b.suggestion && (
                  <div className="suggestion-panel">
                    <div>
                      <strong>
                        {b.suggestion.mode === 'provider'
                          ? 'AI mapping suggestions'
                          : 'Deterministic header suggestions'}{' '}
                        · pending your approval
                      </strong>
                      <p>{b.suggestion.notice ?? b.suggestion.suggestion.reason}</p>
                      <small>
                        {Object.entries(b.suggestion.suggestion.mappings)
                          .map(([h, f]) => `${h} → ${fieldLabels[f as keyof typeof fieldLabels]}`)
                          .join(' · ')}
                      </small>
                    </div>
                    <button
                      className="button secondary"
                      disabled={!canEdit || b.suggestion.revision !== b.revision}
                      onClick={() => {
                        change({
                          mappings: b.suggestion.suggestion.mappings,
                          origin: b.suggestion.mode,
                        });
                        setCategories(dictText(b.suggestion.suggestion.categories));
                        setUnits(dictText(b.suggestion.suggestion.units));
                        setNotice(
                          'Suggestions accepted into your draft. Review defaults and transformations, then validate.',
                        );
                      }}
                    >
                      Accept suggestions
                    </button>
                  </div>
                )}
                <div className="table-scroll">
                  <table className="mapping-table">
                    <thead>
                      <tr>
                        <th>SOURCE COLUMN</th>
                        <th>SAMPLE VALUES</th>
                        <th>CATALOG FIELD</th>
                        <th>ORIGIN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.headers.map((header: string, index: number) => (
                        <tr key={header}>
                          <td>
                            <span className="column-index">{index + 1}</span>
                            <strong>{header}</strong>
                          </td>
                          <td
                            className="sample-values"
                            title={b.samples.map((s: any) => s.values[index]).join(' · ')}
                          >
                            {b.samples.slice(0, 3).map((s: any) => (
                              <code key={s.ordinal}>{s.values[index] || '(blank)'}</code>
                            ))}
                          </td>
                          <td>
                            <select
                              aria-label={`Map ${header}`}
                              value={draft.mappings[header] ?? ''}
                              disabled={!canEdit}
                              onChange={(e) => {
                                const mappings = { ...draft.mappings };
                                if (e.target.value) mappings[header] = e.target.value as any;
                                else delete mappings[header];
                                change({ mappings, origin: 'manual' });
                              }}
                            >
                              <option value="">Do not import</option>
                              {fields.map((f) => (
                                <option key={f} value={f}>
                                  {fieldLabels[f]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <span className="subtle">
                              {draft.mappings[header] ? draft.origin : 'Unmapped'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="surface transformation-panel">
                <div className="section-heading">
                  <div>
                    <h2>Make the rules explicit.</h2>
                    <p>
                      Only these approved operations run. No inferred currencies or missing product
                      facts.
                    </p>
                  </div>
                  <span className="engine-label">DETERMINISTIC ENGINE v1</span>
                </div>
                <div className="transform-grid">
                  <div className="field">
                    <label htmlFor="number-format">Price number format</label>
                    <select
                      id="number-format"
                      disabled={!canEdit}
                      value={draft.numberFormat}
                      onChange={(e) => change({ numberFormat: e.target.value as any })}
                    >
                      <option value="plain">1234.56 · no grouping</option>
                      <option value="comma-grouped">1,234.56 · comma grouping</option>
                      <option value="dot-grouped">1.234,56 · dot grouping</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="currency-token">Remove approved price prefix</label>
                    <select
                      id="currency-token"
                      disabled={!canEdit}
                      value={draft.currencyToken}
                      onChange={(e) => change({ currencyToken: e.target.value as any })}
                    >
                      {['none', 'PHP', 'USD', 'EUR'].map((v) => (
                        <option key={v} value={v}>
                          {v === 'none' ? 'None' : `${v} (must match currency)`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="blank-policy">Mapped blank values</label>
                    <select
                      id="blank-policy"
                      disabled={!canEdit}
                      value={draft.blankPolicy}
                      onChange={(e) => change({ blankPolicy: e.target.value as any })}
                    >
                      <option value="preserve">Preserve existing values</option>
                      <option value="clear">Clear description; error on other fields</option>
                      <option value="error">Report as blocking errors</option>
                    </select>
                  </div>
                  {(['currency', 'category', 'unit'] as const).map((f) => (
                    <div className="field" key={f}>
                      <label htmlFor={`default-${f}`}>Approved {f} default</label>
                      <select
                        id={`default-${f}`}
                        disabled={!canEdit}
                        value={draft.defaults[f] ?? ''}
                        onChange={(e) =>
                          change({
                            defaults: { ...draft.defaults, [f]: e.target.value || undefined },
                          })
                        }
                      >
                        <option value="">No default</option>
                        {session.data.workspace.allowed[
                          f === 'currency'
                            ? 'currencies'
                            : f === 'category'
                              ? 'categories'
                              : 'units'
                        ].map((v: string) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="field">
                    <label htmlFor="category-map">Category mappings</label>
                    <textarea
                      id="category-map"
                      disabled={!canEdit}
                      value={categories}
                      onChange={(e) => {
                        setCategories(e.target.value);
                        setDirty(true);
                      }}
                      placeholder={
                        'computer accessories = Computer accessories\nperipherals = Peripherals'
                      }
                    />
                    <small>One source = allowed destination per line.</small>
                  </div>
                  <div className="field">
                    <label htmlFor="unit-map">Unit mappings</label>
                    <textarea
                      id="unit-map"
                      disabled={!canEdit}
                      value={units}
                      onChange={(e) => {
                        setUnits(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="pcs = piece"
                    />
                    <small>Allowed: {session.data.workspace.allowed.units.join(', ')}</small>
                  </div>
                  <div className="field">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={draft.trim}
                        disabled={!canEdit}
                        onChange={(e) => change({ trim: e.target.checked })}
                      />
                      Trim surrounding whitespace
                    </label>
                    <small>
                      SKU normalization always trims outer whitespace and preserves leading zeros.
                    </small>
                    <label htmlFor="active-default">Approved active default</label>
                    <select
                      id="active-default"
                      disabled={!canEdit}
                      value={draft.defaults.active ?? ''}
                      onChange={(e) =>
                        change({
                          defaults: {
                            ...draft.defaults,
                            active: (e.target.value || undefined) as any,
                          },
                        })
                      }
                    >
                      <option value="">No default (new products active)</option>
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
                <div className="allowed-values">
                  <strong>Allowed categories</strong>
                  <span>{session.data.workspace.allowed.categories.join(' · ')}</span>
                </div>
                <div className="form-footer">
                  <button className="button secondary" onClick={saveMapping} disabled={!canEdit}>
                    <Save size={15} />
                    Save supplier mapping
                  </button>
                  <button
                    className="button primary"
                    onClick={() => save.mutate(b.exclusions)}
                    disabled={!canEdit || save.isPending}
                  >
                    Save & validate
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
            </>
          )}
          {tab === 'review' && (
            <>
              <div className="review-summary">
                {(['create', 'update', 'unchanged', 'blocked', 'excluded'] as const).map((k) => (
                  <button
                    key={k}
                    className={kind === k ? 'selected' : ''}
                    onClick={() => setParams(kind === k ? {} : { kind: k })}
                  >
                    <strong className={k}>{b.counts?.[k] ?? '—'}</strong>
                    <span>
                      {k === 'create'
                        ? 'New products'
                        : k === 'update'
                          ? 'Updates'
                          : k[0].toUpperCase() + k.slice(1)}
                    </span>
                  </button>
                ))}
              </div>
              {dirty && (
                <div className="alert warning">
                  You have unsaved configuration changes. Save and validate before committing.
                </div>
              )}
              <section className="surface">
                <div className="section-heading">
                  <div>
                    <h2>
                      {kind
                        ? `${kind[0].toUpperCase() + kind.slice(1)} records`
                        : 'Every record, accounted for.'}
                    </h2>
                    <p>
                      Compare proposed values with your current catalog. Source record numbers are
                      logical CSV records.
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    disabled={!canEdit || save.isPending}
                    onClick={() => save.mutate(b.exclusions)}
                  >
                    <RefreshCw size={15} />
                    Refresh review
                  </button>
                </div>
                <ErrorBox error={rows.error} />
                {rows.data?.items.length ? (
                  <Table<PreviewRow>
                    data={rows.data.items}
                    columns={[
                      {
                        header: 'RECORD',
                        cell: ({ row }) => (
                          <span className="mono">
                            {String(row.original.record).padStart(3, '0')}
                          </span>
                        ),
                      },
                      {
                        header: 'PRODUCT / SOURCE',
                        cell: ({ row }) => (
                          <div className="product-cell">
                            <strong>
                              {row.original.values?.name ??
                                row.original.source?.[1] ??
                                'Source record'}
                            </strong>
                            <code>{row.original.values?.sku ?? row.original.source?.[0]}</code>
                            <details className="source-details">
                              <summary>Original source values</summary>
                              <dl>
                                {b.headers.map((header: string, index: number) => (
                                  <div key={header}>
                                    <dt>{header}</dt>
                                    <dd>{row.original.source[index] || '(blank)'}</dd>
                                  </div>
                                ))}
                              </dl>
                            </details>
                          </div>
                        ),
                      },
                      {
                        header: 'OUTCOME',
                        cell: ({ row }) => <Badge value={row.original.kind ?? 'mapping'} />,
                      },
                      {
                        header: 'CHANGES & ISSUES',
                        cell: ({ row }) => <RowDetail row={row.original} />,
                      },
                      {
                        header: 'ACTION',
                        cell: ({ row }) =>
                          canEdit && row.original.kind !== 'excluded' ? (
                            <button
                              className="text-button"
                              onClick={() => {
                                setExclude(row.original);
                                setReason('');
                              }}
                            >
                              Exclude record
                            </button>
                          ) : row.original.kind === 'excluded' && canEdit ? (
                            <button
                              className="text-button"
                              onClick={() => {
                                const next = { ...b.exclusions };
                                delete next[row.original.record];
                                save.mutate(next);
                              }}
                            >
                              Restore
                            </button>
                          ) : null,
                      },
                    ]}
                  />
                ) : (
                  <Empty title="No records in this view">
                    <p>Save your mapping and validate, or choose another outcome filter.</p>
                  </Empty>
                )}
                <Pagination
                  page={page}
                  total={rows.data?.total ?? 0}
                  setPage={(n) =>
                    setParams((p) => {
                      p.set('page', String(n));
                      return p;
                    })
                  }
                />
              </section>
              {b.status !== 'completed' && (
                <div className="commit-bar">
                  <div>
                    <strong>
                      {(b.counts?.create ?? 0) + (b.counts?.update ?? 0)} catalog changes
                    </strong>
                    <p>
                      {b.counts?.blocked
                        ? `${b.counts.blocked} blocked records need resolution or an explicit exclusion.`
                        : `${b.counts?.unchanged ?? 0} unchanged · ${b.counts?.excluded ?? 0} excluded · revision ${b.revision}`}
                    </p>
                  </div>
                  <button
                    className="button primary"
                    disabled={
                      !editable ||
                      b.status !== 'review' ||
                      !!b.counts?.blocked ||
                      dirty ||
                      commit.isPending
                    }
                    onClick={() => setConfirm(true)}
                  >
                    Commit import
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
          {tab === 'receipt' && b.receipt && (
            <section className="surface receipt">
              <div className="success-icon">
                <CheckCircle2 size={32} />
              </div>
              <div className="eyebrow">IMPORT COMPLETE</div>
              <h1>Your catalog is up to date.</h1>
              <p>
                Committed by {b.receipt.actor} on {date(b.receipt.created_at)} · Revision{' '}
                {b.receipt.revision}
              </p>
              <div className="receipt-counts">
                {[
                  ['Created', b.receipt.counts.create],
                  ['Updated', b.receipt.counts.update],
                  ['Unchanged', b.receipt.counts.unchanged],
                  ['Excluded', b.receipt.counts.excluded],
                  ['Rejected', b.receipt.counts.rejected],
                ].map(([label, value]) => (
                  <div key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div className="receipt-total">
                {b.receipt.counts.total} source records accounted for. No products were deleted.
              </div>
              <div className="receipt-actions">
                <Link className="button primary" to="/catalog">
                  View catalog
                  <ArrowRight size={16} />
                </Link>
                <a className="button secondary" href={`/api/imports/${id}/report`}>
                  <Download size={15} />
                  Download receipt
                </a>
                <button className="button secondary" onClick={() => setTab('review')}>
                  Inspect records
                </button>
              </div>
              <dl className="receipt-meta">
                <dt>Receipt ID</dt>
                <dd className="mono">{b.receipt.id}</dd>
                <dt>Source fingerprint</dt>
                <dd className="mono hash">{b.sha256}</dd>
                <dt>Original file</dt>
                <dd>
                  <a className="text-link" href={`/api/imports/${id}/source`}>
                    Download untrusted original CSV
                  </a>
                </dd>
              </dl>
            </section>
          )}
        </>
      )}
      {confirm && (
        <Modal title="Commit these catalog changes?" onClose={() => setConfirm(false)}>
          <p>
            This applies the approved preview for revision {b.revision} to {b.supplier_name}.
          </p>
          <div className="confirm-counts">
            <strong>{b.counts.create} new products</strong>
            <strong>{b.counts.update} updates</strong>
            <span>
              {b.counts.unchanged} unchanged · {b.counts.excluded} excluded
            </span>
          </div>
          <p>Every change is recorded in the receipt. Historical undo is not available.</p>
          <ErrorBox error={commit.error} />
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setConfirm(false)}>
              Keep reviewing
            </button>
            <button
              className="button primary"
              disabled={commit.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending ? 'Submitting…' : 'Confirm & commit'}
            </button>
          </div>
        </Modal>
      )}
      {exclude && (
        <Modal
          title={`Exclude source record ${exclude.record}`}
          onClose={() => setExclude(undefined)}
        >
          <p>This source record will be retained in the receipt but will not change the catalog.</p>
          <div className="field">
            <label htmlFor="exclusion-reason">Reason for exclusion</label>
            <textarea
              id="exclusion-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Explain why this record should not be imported."
            />
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setExclude(undefined)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={reason.trim().length < 3 || save.isPending}
              onClick={() => save.mutate({ ...b.exclusions, [exclude.record]: reason })}
            >
              Exclude & revalidate
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function RowDetail({ row }: { row: PreviewRow }) {
  if (row.kind === 'excluded') return <span className="subtle">{row.reason}</span>;
  if (row.issues?.length)
    return (
      <div className="issues-list">
        {row.issues.map((issue, i) => (
          <div key={i}>
            <strong>
              {issue.severity === 'warning' ? 'Warning · ' : ''}
              {issue.field}:{' '}
            </strong>
            {issue.message}
            {issue.original !== undefined && (
              <div>
                Source: <code>{issue.original || '(blank)'}</code>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  if (row.kind === 'unchanged') return <span className="subtle">Matches the current catalog</span>;
  if (row.changes?.length)
    return (
      <details className="diff">
        <summary>
          {row.kind === 'create'
            ? 'View new product'
            : `${row.changes.length} field${row.changes.length === 1 ? '' : 's'} changed`}
        </summary>
        {row.changes.map((c) => (
          <div className="diff-line" key={c.field}>
            <strong>{fieldLabels[c.field as keyof typeof fieldLabels]}</strong>
            <del>{c.before === null ? '—' : String(c.before)}</del>
            <ArrowRight size={12} />
            <ins>{c.after === null ? '(cleared)' : String(c.after)}</ins>
          </div>
        ))}
      </details>
    );
  return <span className="subtle">Awaiting validation</span>;
}
