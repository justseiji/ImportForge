import type { Database } from './db.ts';
import { json } from './db.ts';
import { passwordHash } from './auth.ts';
export async function seed(db: Database, password = process.env.DEMO_PASSWORD) {
  if ((await db.query('SELECT id FROM workspaces LIMIT 1')).length) return;
  if (!password || password.length < 12)
    throw new Error('Set DEMO_PASSWORD to at least 12 characters before seeding.');
  const hash = await passwordHash(password);
  await db.transaction(async (tx) => {
    await tx.query('INSERT INTO workspaces(id,name,allowed) VALUES($1,$2,$3::jsonb)', [
      'ws-demo',
      'Northstar Trading',
      json({
        categories: ['Computer accessories', 'Peripherals', 'Office supplies', 'Cables & adapters'],
        currencies: ['PHP', 'USD', 'EUR'],
        units: ['piece', 'pack', 'box', 'meter'],
      }),
    ]);
    for (const [role, name] of [
      ['owner', 'Alex Morgan'],
      ['editor', 'Jamie Rivera'],
      ['viewer', 'Sam Chen'],
    ]) {
      await tx.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
        `user-${role}`,
        `${role}@importforge.local`,
        name,
        hash,
      ]);
      await tx.query('INSERT INTO memberships VALUES($1,$2,$3)', ['ws-demo', `user-${role}`, role]);
    }
    for (const [id, name, contact] of [
      ['sup-nova', 'NovaTech Supply', 'orders@novatech.example'],
      ['sup-paper', 'Paper & Co.', 'catalog@paperco.example'],
      ['sup-link', 'Linkline Distribution', 'supply@linkline.example'],
    ])
      await tx.query('INSERT INTO suppliers(id,workspace_id,name,contact) VALUES($1,$2,$3,$4)', [
        id,
        'ws-demo',
        name,
        contact,
      ]);
    const rows = [
      ['00042', 'Wireless Mouse', 'Computer accessories', '425.00', 'sup-nova'],
      ['00044', 'USB-C Hub · 7 ports', 'Computer accessories', '1850.00', 'sup-nova'],
      ['00045', 'Laptop Stand', 'Computer accessories', '795.00', 'sup-nova'],
      ['00046', 'Compact Bluetooth Keyboard', 'Peripherals', '1290.00', 'sup-nova'],
      ['00047', 'HD Webcam · 1080p', 'Peripherals', '1695.00', 'sup-nova'],
      ['00048', 'Desk Mat · Graphite', 'Office supplies', '350.00', 'sup-nova'],
      ['P-100', 'A4 Copy Paper · 500 sheets', 'Office supplies', '245.00', 'sup-paper'],
      ['P-101', 'Hardcover Notebook', 'Office supplies', '185.00', 'sup-paper'],
      ['P-102', 'Ballpoint Pen · 12 pack', 'Office supplies', '96.00', 'sup-paper'],
      ['L-200', 'USB-C Cable · 1 meter', 'Cables & adapters', '195.00', 'sup-link'],
      ['L-201', 'HDMI Cable · 2 meters', 'Cables & adapters', '325.00', 'sup-link'],
      ['L-202', 'Ethernet Adapter', 'Cables & adapters', '650.00', 'sup-link'],
    ];
    for (const [i, r] of rows.entries())
      await tx.query(
        'INSERT INTO products(id,workspace_id,supplier_id,sku,original_sku,name,description,category,price,currency,unit) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8::numeric,$9,$10)',
        [
          `product-${i}`,
          'ws-demo',
          r[4],
          r[0],
          r[1],
          'Original catalog listing',
          r[2],
          r[3],
          'PHP',
          'piece',
        ],
      );
  });
}
