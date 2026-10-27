import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Download, Search } from 'lucide-react';
import { api, keys } from '../../lib/api';
import {
  Empty,
  ErrorBox,
  Loading,
  PageHeading,
  Pagination,
  Table,
  date,
  money,
} from '../../components/ui';
export function Catalog() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const { data, error } = useQuery({
    queryKey: [...keys.catalog, params.toString()],
    queryFn: () => api(`/catalog?${params}`),
  });
  const suppliers = useQuery({ queryKey: keys.suppliers, queryFn: () => api('/suppliers') });
  function filter(k: string, v: string) {
    setParams((p) => {
      p.set(k, v);
      p.delete('page');
      return p;
    });
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR DESTINATION"
        title="A catalog you can trust."
        description="One consistent place for every supplier’s product offering."
        actions={
          <a className="button secondary" href="/api/catalog/export">
            <Download size={16} />
            Export catalog
          </a>
        }
      />
      <section className="surface">
        <div className="section-heading">
          <div>
            <h2>
              Product catalog <span className="count">{data?.total ?? 0}</span>
            </h2>
            <p>Each product is identified by its supplier and SKU.</p>
          </div>
          <span className="subtle">Changes are traced to their source</span>
        </div>
        <div className="toolbar">
          <select
            aria-label="Sort catalog"
            value={params.get('sort') ?? 'name'}
            onChange={(e) => filter('sort', e.target.value)}
          >
            <option value="name">Name A–Z</option>
            <option value="sku">SKU A–Z</option>
            <option value="price">Price low–high</option>
            <option value="updated">Recently updated</option>
          </select>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search catalog"
              placeholder="Search products or SKUs…"
              value={params.get('q') ?? ''}
              onChange={(e) => filter('q', e.target.value)}
            />
          </label>
          <select
            aria-label="Filter supplier"
            value={params.get('supplier') ?? ''}
            onChange={(e) => filter('supplier', e.target.value)}
          >
            <option value="">All suppliers</option>
            {suppliers.data?.items.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <ErrorBox error={error} />
        {!data ? (
          <Loading />
        ) : !data.items.length ? (
          <Empty title="No products found">
            <p>Try a different search or complete a supplier import.</p>
          </Empty>
        ) : (
          <Table
            data={data.items}
            columns={[
              {
                header: 'PRODUCT',
                cell: ({ row }: any) => (
                  <Link className="product-cell" to={`/catalog/${row.original.id}`}>
                    <strong>{row.original.name}</strong>
                    <span>{row.original.category}</span>
                  </Link>
                ),
              },
              { header: 'SKU', cell: ({ row }: any) => <code>{row.original.sku}</code> },
              { header: 'SUPPLIER', accessorKey: 'supplier_name' },
              {
                header: 'UNIT PRICE',
                cell: ({ row }: any) => (
                  <span className="price">{money(row.original.price, row.original.currency)}</span>
                ),
              },
              { header: 'UNIT', accessorKey: 'unit' },
              {
                header: 'STATUS',
                cell: ({ row }: any) => (
                  <span className={`badge ${row.original.active ? 'completed' : 'excluded'}`}>
                    {row.original.active ? 'Active' : 'Inactive'}
                  </span>
                ),
              },
              {
                header: 'UPDATED',
                cell: ({ row }: any) => (
                  <span className="subtle">{date(row.original.updated_at)}</span>
                ),
              },
              {
                header: '',
                id: 'open',
                cell: ({ row }: any) => (
                  <Link
                    aria-label={`View ${row.original.name}`}
                    className="icon-button"
                    to={`/catalog/${row.original.id}`}
                  >
                    <ArrowUpRight size={16} />
                  </Link>
                ),
              },
            ]}
          />
        )}
        <Pagination
          page={page}
          total={data?.total ?? 0}
          setPage={(n) =>
            setParams((p) => {
              p.set('page', String(n));
              return p;
            })
          }
        />
      </section>
      <div className="quiet-note">
        Products absent from an import remain in your catalog. No automatic deletions.
      </div>
    </>
  );
}
export function ProductDetail() {
  const { id } = useParams();
  const { data, error } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api(`/catalog/${id}`),
  });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const p = data.product;
  return (
    <>
      <Link className="back-link" to="/catalog">
        ← Product catalog
      </Link>
      <PageHeading
        eyebrow={p.supplier_name}
        title={p.name}
        description={`SKU ${p.sku} · Record version ${p.version}`}
      />
      <div className="product-layout">
        <section className="surface">
          <div className="section-heading">
            <h2>Product details</h2>
            <span className="badge completed">{p.active ? 'Active' : 'Inactive'}</span>
          </div>
          <dl className="detail-list">
            {[
              ['SKU', p.sku],
              ['Original SKU', p.original_sku],
              ['Category', p.category],
              ['Unit price', money(p.price, p.currency)],
              ['Unit', p.unit],
              ['Description', p.description ?? 'No description'],
              ['Last updated', date(p.updated_at)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="surface">
          <div className="section-heading">
            <div>
              <h2>Change history</h2>
              <p>Follow each change back to its source.</p>
            </div>
          </div>
          {data.history.length ? (
            data.history.map((event: any) => (
              <article className="history-event" key={event.id}>
                <span className="history-dot" />
                <div>
                  <strong>{event.kind === 'create' ? 'Product created' : 'Product updated'}</strong>
                  <small>
                    {event.actor} · {date(event.created_at)}
                  </small>
                  <Link className="text-link" to={`/imports/${event.import_id}`}>
                    {event.filename} · Record {event.record}
                    <ArrowUpRight size={13} />
                  </Link>
                  {event.detail.changes.map((c: any) => (
                    <div className="history-change" key={c.field}>
                      <span>{c.field}</span>
                      <del>{String(c.before ?? '—')}</del>
                      <span>→</span>
                      <ins>{String(c.after ?? '—')}</ins>
                    </div>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <Empty title="Original catalog record">
              <p>
                This product was included in the seeded catalog. Future imported changes will appear
                here.
              </p>
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
