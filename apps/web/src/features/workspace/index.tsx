import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@importforge/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowRightLeft, ShieldCheck } from 'lucide-react';
import { api, client, keys } from '../../lib/api';
import { ErrorBox, Loading, PageHeading, Table } from '../../components/ui';
import { useSession } from '../../lib/session';
export function Login() {
  const [error, setError] = useState<unknown>();
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: 'owner@importforge.local', password: '' },
  });
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="wordmark">
          <span className="brand-glyph">
            <ArrowRightLeft size={21} />
          </span>
          ImportForge.
        </div>
        <div>
          <div className="eyebrow">FROM MESSY FILES TO TRUSTED DATA</div>
          <h1>
            A clearer path
            <br />
            to your catalog.
          </h1>
          <p>
            Map with intention. Review every change.
            <br />
            Bring your next supplier update into focus.
          </p>
          <div className="login-diagram">
            <span>Supplier CSV</span>
            <ArrowRight />
            <span>Reviewed changes</span>
            <ArrowRight />
            <span>Your catalog</span>
          </div>
        </div>
        <span className="login-foot">
          <ShieldCheck size={17} />
          Human decisions. Deterministic imports.
        </span>
      </div>
      <section className="login-form">
        <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
        <h2>Good to see you.</h2>
        <p>Sign in to continue with your catalog.</p>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            try {
              await api('/auth/login', values);
              await client.invalidateQueries({ queryKey: keys.session });
            } catch (e) {
              setError(e);
            }
          })}
        >
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              aria-describedby="email-error"
              aria-invalid={!!form.formState.errors.email}
              {...form.register('email')}
            />
            <small id="email-error" role="alert">
              {form.formState.errors.email?.message}
            </small>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-describedby="password-error"
              aria-invalid={!!form.formState.errors.password}
              {...form.register('password')}
            />
            <small id="password-error" role="alert">
              {form.formState.errors.password?.message}
            </small>
          </div>
          <ErrorBox error={error} />
          <button className="button primary" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Signing in…' : 'Sign in to workspace'}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="login-demo">
          <strong>Running the local demo?</strong>
          <p>
            Use a seeded owner, editor, or viewer account and the password you set in{' '}
            <code>DEMO_PASSWORD</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
export function Settings() {
  const session = useSession();
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const members = useQuery({ queryKey: ['members'], queryFn: () => api('/members') });
  const [draft, setDraft] = useState<Record<string, string>>({}),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(false);
  const owner = session.data?.user.role === 'owner';
  if (!query.data) return <Loading />;
  async function save() {
    try {
      const allowed = Object.fromEntries(
        ['categories', 'currencies', 'units'].map((key) => [
          key,
          (draft[key] ?? query.data.allowed[key].join('\n'))
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        ]),
      );
      await api('/settings', allowed, 'PUT');
      await client.invalidateQueries({ queryKey: ['settings'] });
      await client.invalidateQueries({ queryKey: keys.session });
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE SETTINGS"
        title="Set the standard."
        description="Define the allowed catalog values and who can make changes."
      />
      <ErrorBox error={error} />
      {saved && (
        <div className="alert info" role="status">
          Workspace values saved. Existing previews are checked against these values at commit.
        </div>
      )}
      <section className="surface">
        <div className="section-heading">
          <div>
            <h2>Allowed catalog values</h2>
            <p>
              One value per line. Imports must match these values after approved transformations.
            </p>
          </div>
        </div>
        <div className="settings-grid">
          {['categories', 'currencies', 'units'].map((key) => (
            <div className="field" key={key}>
              <label htmlFor={key}>{key[0].toUpperCase() + key.slice(1)}</label>
              <textarea
                id={key}
                disabled={!owner}
                value={draft[key] ?? query.data.allowed[key].join('\n')}
                onChange={(e) => {
                  setDraft({ ...draft, [key]: e.target.value });
                  setSaved(false);
                }}
              />
            </div>
          ))}
        </div>
        {owner && (
          <div className="form-footer">
            <span>Existing catalog records remain unchanged.</span>
            <button className="button primary" onClick={save}>
              Save allowed values
            </button>
          </div>
        )}
      </section>
      <section className="surface members-panel">
        <div className="section-heading">
          <div>
            <h2>Workspace members</h2>
            <p>Owners configure access. Editors import. Viewers inspect.</p>
          </div>
          <span className="subtle">{session.data.workspace.name}</span>
        </div>
        <Table
          data={members.data?.items ?? []}
          columns={[
            {
              header: 'MEMBER',
              cell: ({ row }: any) => (
                <div className="product-cell">
                  <strong>{row.original.name}</strong>
                  <span>{row.original.email}</span>
                </div>
              ),
            },
            {
              header: 'ROLE',
              cell: ({ row }: any) =>
                owner ? (
                  <select
                    aria-label={`Role for ${row.original.name}`}
                    value={row.original.role}
                    onChange={async (e) => {
                      try {
                        await api(`/members/${row.original.id}`, { role: e.target.value }, 'PATCH');
                        await client.invalidateQueries({ queryKey: ['members'] });
                        await client.invalidateQueries({ queryKey: keys.session });
                      } catch (err) {
                        setError(err);
                      }
                    }}
                  >
                    {['owner', 'editor', 'viewer'].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                ) : (
                  row.original.role
                ),
            },
          ]}
        />
      </section>
      <div className="quiet-note">
        New account invitations are outside this local release. Seeded memberships support role
        demonstrations.
      </div>
    </>
  );
}
