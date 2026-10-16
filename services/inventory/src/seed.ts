import path from 'node:path';
import { config } from './config';
import { createPool } from './lib/db';
import { runMigrations } from './lib/migrate';

const products: [string, string, string, number, number][] = [
  ['KB-MECH-01', 'Mechanical Keyboard', 'Hot-swappable 75% layout with tactile switches', 8999, 40],
  ['MS-WL-02', 'Wireless Mouse', 'Ergonomic 2.4GHz mouse, 6 buttons', 3499, 120],
  ['MN-27-4K', '27" 4K Monitor', 'IPS panel, USB-C 90W power delivery', 38900, 15],
  ['HS-NC-05', 'Noise-Cancelling Headset', 'Over-ear, 30h battery, boom mic', 15900, 25],
  ['DK-USB-C', 'USB-C Docking Station', '12-in-1 dock with dual HDMI and Ethernet', 12900, 30],
  ['WC-1080', 'HD Webcam', '1080p, autofocus, privacy shutter', 5900, 60],
  ['SD-1TB', 'Portable SSD 1TB', 'USB 3.2 Gen 2, 1050MB/s', 9900, 45],
  ['CH-ERG-09', 'Ergonomic Office Chair', 'Lumbar support, adjustable arms', 24900, 8],
  ['DS-ELEC', 'Electric Standing Desk', 'Dual motor, memory presets, 120x60cm', 42900, 5],
  ['LP-STD-14', 'Laptop Stand', 'Aluminium, adjustable height', 3999, 80],
  ['CB-HDMI-2M', 'HDMI 2.1 Cable (2m)', '8K60 / 4K120 certified', 1499, 200],
  ['PW-UPS-650', 'UPS 650VA', 'Line-interactive battery backup', 8900, 12],
  ['RT-AX-6', 'Wi-Fi 6 Router', 'Dual-band AX3000', 10900, 18],
  ['SP-BT-03', 'Bluetooth Speaker', 'Waterproof, 12h playtime', 4500, 0],
];

async function main() {
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool, path.join(__dirname, '..', 'migrations'));
  for (const [sku, name, description, price, stock] of products) {
    await pool.query(
      `INSERT INTO products (sku, name, description, price_cents, stock) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sku) DO NOTHING`,
      [sku, name, description, price, stock],
    );
  }
  console.log(`Seeded ${products.length} products`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
