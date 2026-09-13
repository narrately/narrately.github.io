import pc from 'picocolors';

const quiet = () => process.env.NARRATELY_QUIET === '1';

export const log = {
  info: (...args) => !quiet() && console.log(...args),
  step: (...args) => !quiet() && console.log(pc.cyan('›'), ...args),
  ok: (...args) => !quiet() && console.log(pc.green('✓'), ...args),
  warn: (...args) => console.warn(pc.yellow('!'), ...args),
  error: (...args) => console.error(pc.red('✗'), ...args),
  dim: (...args) => !quiet() && console.log(pc.dim(args.join(' '))),
  title: (text) => !quiet() && console.log('\n' + pc.bold(text)),
};

export { pc };
