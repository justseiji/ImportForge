import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  UploadCloud,
} from 'lucide-react';
import { api, keys, uploadFile } from '../../lib/api';
import {
  Badge,
  Empty,
  ErrorBox,
  Loading,
  PageHeading,
  Pagination,
  Table,
  date,
} from '../../components/ui';
import { useSession } from '../../lib/session';
export function Imports() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1),
    q = params.get('q') ?? '',
    status = params.get('status') ?? '';
  const { data, error } = useQuery({
    queryKey: [...keys.imports, params.toString()],
    queryFn: () => api(`/imports?${params}`),
    refetchInterval: 3000,
  });
  const session = useSession();
  const edit = session.data?.user.role !== 'viewer';
  function filter(key: string, value: string) {
    setParams((p) => {
      p.set(key, value);
      p.delete('page');
      return p;
    });
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR IMPORT WORKSPACE"
        title="Good data starts here."
        description="Bring supplier files into your catalog, one clear step at a time."
        actions={
          edit && (
            <Link className="button primary" to="/imports/new">
              <Plus size={17} />
              New import
            </Link>
          )
        }
      />
      <div className="stats-strip">
        <div>
          <span className="stat-icon">
            <FileSpreadsheet size={19} />
          </span>
          <div>
            <span>Total imports</span>
            <strong>{data?.stats.total ?? '—'}</strong>
          </div>
        </div>
        <div>
          <span className="stat-icon amber">
            <Clock3 size={19} />
          </span>
          <div>
            <span>Needs attention</span>
            <strong>{data?.stats.attention ?? '—'}</strong>
          </div>
        </div>
        <div>
          <span className="stat-icon green">
            <Check size={19} />
          </span>
          <div>
            <span>Completed imports</span>
            <strong>{data?.stats.completed ?? '—'}</strong>
          </div>
        </div>
        <div className="stats-caption">
          A clear path from
          <br />
          <strong>source file to trusted catalog.</strong>
        </div>
      </div>
      <section className="surface">
        <div className="section-heading">
          <div>
            <h2>
              Import queue <span className="count">{data?.total ?? 0}</span>
            </h2>
            <p>Your files, progress, and next steps.</p>
          </div>
          <span className="subtle">Updated automatically</span>
        </div>
        <div className="toolbar">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search imports"
              placeholder="Search files or suppliers…"
              value={q}
              onChange={(e) => filter('q', e.target.value)}
            />
          </label>
          <select
            aria-label="Filter import status"
            value={status}
            onChange={(e) => filter('status', e.target.value)}
          >
            <option value="">All statuses</option>
            {['mapping', 'review', 'completed', 'failed', 'parsing', 'preparing', 'committing'].map(
              (s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ),
            )}
          </select>
        </div>
        <ErrorBox error={error} />
        {!data ? (
          <Loading />
        ) : data.items.length ? (
          <Table
            data={data.items}
            columns={[
              {
                header: 'SOURCE FILE',
                cell: ({ row }: any) => (
                  <Link className="file-cell" to={`/imports/${row.original.id}`}>
                    <span className="file-icon">
                      <FileSpreadsheet size={20} />
                    </span>
                    <span>
                      <strong>{row.original.filename}</strong>
                      <small>CSV import</small>
                    </span>
                  </Link>
                ),
              },
              { header: 'SUPPLIER', accessorKey: 'supplier_name' },
              { header: 'STATUS', cell: ({ row }: any) => <Badge value={row.original.status} /> },
              {
                header: 'RECORDS',
                cell: ({ row }: any) => (
                  <span className="mono">{row.original.row_count ?? '—'}</span>
                ),
              },
              {
                header: 'LAST ACTIVITY',
                cell: ({ row }: any) => (
                  <span className="subtle">{date(row.original.updated_at)}</span>
                ),
              },
              { header: 'OWNER', accessorKey: 'owner' },
              {
                id: 'open',
                header: '',
                cell: ({ row }: any) => (
                  <Link
                    className="icon-button"
                    aria-label={`Open ${row.original.filename}`}
                    to={`/imports/${row.original.id}`}
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                ),
              },
            ]}
          />
        ) : (
          <Empty
            title={
              q || status ? 'No imports match your filters' : 'Your next catalog update starts here'
            }
          >
            <p>Upload a supplier CSV, review the changes, and import with a complete record.</p>
            {edit && (
              <Link className="button primary" to="/imports/new">
                <Plus size={16} />
                Start your first import
              </Link>
            )}
          </Empty>
        )}
        <Pagination
          total={data?.total ?? 0}
          page={page}
          setPage={(n) =>
            setParams((p) => {
              p.set('page', String(n));
              return p;
            })
          }
        />
      </section>
      <div className="example-callout">
        <span className="example-symbol">
          <ArrowRight size={20} />
        </span>
        <div>
          <strong>Meet your next supplier file.</strong>
          <p>Try a realistic CSV with price updates, new products, and a few things to clean up.</p>
        </div>
        <a href="/samples/novatech-messy.csv" download className="button secondary">
          <Download size={15} />
          Try an example
        </a>
      </div>
      <div className="workflow-note">
        <span>
          01 <strong>Upload a file</strong>
        </span>
        <ArrowRight size={14} />
        <span>
          02 <strong>Map & validate</strong>
        </span>
        <ArrowRight size={14} />
        <span>
          03 <strong>Review changes</strong>
        </span>
        <ArrowRight size={14} />
        <span>
          04 <strong>Commit with confidence</strong>
        </span>
      </div>
    </>
  );
}
export function NewImport() {
  const navigate = useNavigate();
  const suppliers = useQuery({ queryKey: keys.suppliers, queryFn: () => api('/suppliers') });
  const [supplier, setSupplier] = useState('sup-nova'),
    [file, setFile] = useState<File>(),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const session = useSession();
  if (session.data?.user.role === 'viewer')
    return <ErrorBox error={new Error('Editor access is required to upload files.')} />;
  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await uploadFile(supplier, file, setProgress);
      navigate(`/imports/${result.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" to="/imports">
        ← All imports
      </Link>
      <PageHeading
        eyebrow="NEW IMPORT"
        title="Let’s get your file ready."
        description="Choose the supplier, then add the CSV you want to bring into your catalog."
      />
      <div className="upload-layout">
        <section className="surface upload-form">
          <div className="field">
            <label htmlFor="supplier">
              Supplier <span className="required">*</span>
            </label>
            <select id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              {suppliers.data?.items.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <small>Products are matched by this supplier and SKU.</small>
          </div>
          <label
            className={`dropzone ${file ? 'has-file' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFile(e.dataTransfer.files[0]);
            }}
          >
            <span className="upload-icon">
              <UploadCloud size={28} />
            </span>
            <strong>{file ? file.name : 'Drop your supplier file here'}</strong>
            <span>
              {file
                ? `${(file.size / 1024).toFixed(1)} KB · ready to upload`
                : 'or browse files on your computer'}
            </span>
            <input
              aria-label="Supplier CSV file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
            <small>UTF-8 CSV · up to 20 MiB · 50,000 records</small>
          </label>
          <ErrorBox error={error} />
          {busy && (
            <div className="upload-progress" role="status">
              <progress max="100" value={progress} />
              <span>
                {progress < 100
                  ? `Uploading ${progress}%`
                  : 'File transferred. Creating your import…'}
              </span>
            </div>
          )}
          <div className="form-footer">
            <span>Uploading does not change your catalog.</span>
            <button
              className="button primary"
              disabled={!file || busy || !supplier}
              onClick={submit}
            >
              {busy ? 'Uploading…' : 'Upload & inspect'}
              <ArrowRight size={16} />
            </button>
          </div>
        </section>
        <aside className="upload-help">
          <span className="eyebrow">WHAT HAPPENS NEXT</span>
          <h2>
            A little structure.
            <br />A lot more clarity.
          </h2>
          {[
            [
              '1',
              'Inspect your source',
              'We check the file structure and preserve your original values.',
            ],
            ['2', 'Make it your catalog', 'Map columns and approve how values are standardized.'],
            [
              '3',
              'Review every change',
              'See new products and exact updates before anything is committed.',
            ],
          ].map(([n, t, d]) => (
            <div className="help-step" key={n}>
              <span>{n}</span>
              <div>
                <strong>{t}</strong>
                <p>{d}</p>
              </div>
            </div>
          ))}
          <a className="text-link" download href="/samples/novatech-messy.csv">
            <Download size={15} />
            Download the example CSV
          </a>
        </aside>
      </div>
    </>
  );
}
