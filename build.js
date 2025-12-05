// build.js
import { build } from 'vite';

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
