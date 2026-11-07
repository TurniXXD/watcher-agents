import * as migration_20261106_215723_initial from './20261106_215723_initial';
import * as migration_20261107_141604_legacy_backfill_task from './20261107_141604_legacy_backfill_task';
import * as migration_20261107_141700_queue_legacy_bot_content_backfill from './20261107_141700_queue_legacy_bot_content_backfill';

export const migrations = [
  {
    up: migration_20261106_215723_initial.up,
    down: migration_20261106_215723_initial.down,
    name: '20261106_215723_initial',
  },
  {
    up: migration_20261107_141604_legacy_backfill_task.up,
    down: migration_20261107_141604_legacy_backfill_task.down,
    name: '20261107_141604_legacy_backfill_task'
  },
  {
    up: migration_20261107_141700_queue_legacy_bot_content_backfill.up,
    down: migration_20261107_141700_queue_legacy_bot_content_backfill.down,
    name: '20261107_141700_queue_legacy_bot_content_backfill'
  },
];
