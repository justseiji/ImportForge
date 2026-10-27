import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supplierSchema } from '@importforge/contracts';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, client, keys } from '../../lib/api';
import { Empty, ErrorBox, Modal, PageHeading, date } from '../../components/ui';
import { useSession } from '../../lib/session';
export function Suppliers() {
  const { data, error } = useQuery({ queryKey: keys.suppliers, queryFn: () => api('/suppliers') });
  const [adding, setAdding] = useState(false),
    [selected, setSelected] = useState<any>(),
    [failure, setFailure] = useState<unknown>();
  const form = useForm({
    resolver: zodResolver(supplierSchema),
    defaultValues: { name: '', contact: '' },
  });
  const session = useSession();
  const mappings = useQuery({
    queryKey: ['mappings', selected?.id],
    queryFn: () => api(`/suppliers/${selected.id}/mappings`),
    enabled: !!selected,
  });
  return (
    <>
      <PageHeading
        eyebrow="YOUR SUPPLY NETWORK"
        title="Familiar suppliers. Faster imports."
        description="Keep supplier offerings distinct and reuse approved mapping configurations."
        actions={
          session.data?.user.role !== 'viewer' && (
            <button className="button primary" onClick={() => setAdding(true)}>
              <Plus size={16} />
              Add supplier
            </button>
          )
        }
      />
      <ErrorBox error={error} />
      <div className="supplier-grid">
        {data?.items.map((s: any) => (
          <section className="surface supplier-card" key={s.id}>
            <span className="supplier-logo">
              <Building2 size={23} />
            </span>
            <h2>{s.name}</h2>
            <p>{s.contact || 'No contact recorded'}</p>
            <div className="supplier-metrics">
              <div>
                <strong>{s.products}</strong>
                <span>Catalog products</span>
              </div>
              <div>
                <strong>{s.mapping_version ? `v${s.mapping_version}` : '—'}</strong>
                <span>Saved mapping</span>
              </div>
            </div>
            <div className="supplier-actions">
              <Link className="text-link" to={`/catalog?supplier=${s.id}`}>
                View products →
              </Link>
              <button className="text-button" onClick={() => setSelected(s)}>
                Mapping history
              </button>
            </div>
          </section>
        ))}
      </div>
      {adding && (
        <Modal title="Add a supplier" onClose={() => setAdding(false)}>
          <form
            onSubmit={form.handleSubmit(async (values) => {
              try {
                await api('/suppliers', values);
                await client.invalidateQueries({ queryKey: keys.suppliers });
                setAdding(false);
                form.reset();
              } catch (e) {
                setFailure(e);
              }
            })}
          >
            <div className="field">
              <label htmlFor="supplier-name">Supplier name</label>
              <input id="supplier-name" {...form.register('name')} />
              <small role="alert">{form.formState.errors.name?.message}</small>
            </div>
            <div className="field">
              <label htmlFor="supplier-contact">Contact information</label>
              <input id="supplier-contact" {...form.register('contact')} />
            </div>
            <ErrorBox error={failure} />
            <div className="dialog-actions">
              <button className="button primary" disabled={form.formState.isSubmitting}>
                Create supplier
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal title={`${selected.name} · Mapping history`} onClose={() => setSelected(undefined)}>
          {mappings.data?.items.length ? (
            mappings.data.items.map((m: any) => (
              <div className="mapping-version" key={m.id}>
                <strong>Version {m.version}</strong>
                <span>{date(m.created_at)}</span>
                <p>
                  {Object.keys(m.config.mappings).length} mapped columns · {m.config.origin}
                </p>
                <small>{m.headers.join(' · ')}</small>
              </div>
            ))
          ) : (
            <Empty title="No saved mappings yet">
              <p>Save an approved configuration from an import’s mapping workspace.</p>
            </Empty>
          )}
        </Modal>
      )}
    </>
  );
}
