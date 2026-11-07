import * as migration_20261106_215723_initial from './20261106_215723_initial';
import * as migration_20261107_142132_mcp_api_keys from './20261107_142132_mcp_api_keys';

export const migrations = [
  {
    up: migration_20261106_215723_initial.up,
    down: migration_20261106_215723_initial.down,
    name: '20261106_215723_initial',
  },
  {
    up: migration_20261107_142132_mcp_api_keys.up,
    down: migration_20261107_142132_mcp_api_keys.down,
    name: '20261107_142132_mcp_api_keys'
  },
];
