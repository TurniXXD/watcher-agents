import * as migration_20261106_215723_initial from './20261106_215723_initial';

export const migrations = [
  {
    up: migration_20261106_215723_initial.up,
    down: migration_20261106_215723_initial.down,
    name: '20261106_215723_initial'
  },
];
