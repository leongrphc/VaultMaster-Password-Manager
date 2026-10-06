// Internal drill worker; NODE_ENV=test prevents the imported module auto-listening.
// Historical artifacts may have unsafe logs. Disable sinks before importing them.
console.log = () => {}; console.error = () => {}; console.warn = () => {};
const { createApp } = await import(process.env.VM_ROLLBACK_MODULE);
const server = createApp().listen(0, '127.0.0.1', () => {
  process.send({ port: server.address().port });
});
process.on('message', message => {
  if (message === 'stop') server.close(() => process.exit(0));
});
