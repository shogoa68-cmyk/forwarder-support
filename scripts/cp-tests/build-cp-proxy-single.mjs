// 互換用：cp-proxy の貼り付け用 1 枚版を作る（実体は build-edge-single.mjs）。
process.argv[2] = 'cp-proxy';
await import('./build-edge-single.mjs');
