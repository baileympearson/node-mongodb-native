import type { ChildProcess } from 'child_process';

import { type Callback } from '../utils';
import { type AutoEncryptionExtraOptions } from './autoEncrypter';

/**
 * @internal
 * An internal class that handles spawning a mongocryptd.
 */
export class MongocryptdManager {
  static DEFAULT_MONGOCRYPTD_URI = 'mongodb://localhost:27020';

  uri: string;
  bypassSpawn: boolean;
  spawnPath: string;
  spawnArgs: Array<string>;
  _child?: ChildProcess;

  constructor(extraOptions: AutoEncryptionExtraOptions = {}) {
    this.uri =
      typeof extraOptions.mongocryptdURI === 'string' && extraOptions.mongocryptdURI.length > 0
        ? extraOptions.mongocryptdURI
        : MongocryptdManager.DEFAULT_MONGOCRYPTD_URI;

    this.bypassSpawn = !!extraOptions.mongocryptdBypassSpawn;

    this.spawnPath = extraOptions.mongocryptdSpawnPath || '';
    this.spawnArgs = [];
    if (Array.isArray(extraOptions.mongocryptdSpawnArgs)) {
      this.spawnArgs = this.spawnArgs.concat(extraOptions.mongocryptdSpawnArgs);
    }
    if (
      this.spawnArgs
        .filter(arg => typeof arg === 'string')
        .every(arg => arg.indexOf('--idleShutdownTimeoutSecs') < 0)
    ) {
      this.spawnArgs.push('--idleShutdownTimeoutSecs', '60');
    }
  }

  /**
   * Will check to see if a mongocryptd is up. If it is not up, it will attempt
   * to spawn a mongocryptd in a detached process, and then wait for it to be up.
   */
  spawn(callback: Callback<void>) {
    const cmdName = this.spawnPath || 'mongocryptd';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { spawn } = require('child_process') as typeof import('child_process');

    // Spawned with stdio: ignore and detatched:true
    // to ensure child can outlive parent.
    this._child = spawn(cmdName, this.spawnArgs, {
      stdio: 'ignore',
      detached: true
    });

    this._child.on('error', () => {
      // perhaps questionable, but we swallow mongocryptd spawn errors.
    });

    // unref child to remove handle from event loop
    this._child.unref();

    process.nextTick(callback);
  }
}