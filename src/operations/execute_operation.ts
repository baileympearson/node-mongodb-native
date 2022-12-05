import type { Document } from '../bson';
import {
  isRetryableReadError,
  isRetryableWriteError,
  MongoCompatibilityError,
  MONGODB_ERROR_CODES,
  MongoError,
  MongoErrorLabel,
  MongoExpiredSessionError,
  MongoNetworkError,
  MongoNotConnectedError,
  MongoRuntimeError,
  MongoServerError,
  MongoTransactionError,
  MongoUnexpectedServerResponseError
} from '../error';
import type { MongoClient } from '../mongo_client';
import { ReadPreference } from '../read_preference';
import type { Server } from '../sdam/server';
import {
  sameServerSelector,
  secondaryWritableServerSelector,
  ServerSelector
} from '../sdam/server_selection';
import type { ClientSession } from '../sessions';
import { Callback, maybeCallback, supportsRetryableWrites } from '../utils';
import { AbstractOperation, Aspect } from './operation';

const MMAPv1_RETRY_WRITES_ERROR_CODE = MONGODB_ERROR_CODES.IllegalOperation;
const MMAPv1_RETRY_WRITES_ERROR_MESSAGE =
  'This MongoDB deployment does not support retryable writes. Please add retryWrites=false to your connection string.';

function pipe(...middleware: any[]) {
  if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!');
  for (const fn of middleware) {
    if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!');
  }

  return function (context: Record<string, any>, next: any) {
    // last called middleware #
    return dispatch(0);
    function dispatch(i: number): Promise<any> {
      let fn = middleware[i];
      if (i === middleware.length) fn = next;
      if (!fn) return Promise.resolve();
      try {
        return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };
}

async function withConnectedClient(context: Record<string, any>, next: any) {
  const { client } = context;
  if (client.topology == null) {
    // Auto connect on operation
    if (client.s.hasBeenClosed) {
      throw new MongoNotConnectedError('Client must be connected before running operations');
    }
    client.s.options[Symbol.for('@@mdb.skipPingOnConnect')] = true;
    try {
      await client.connect();
    } finally {
      delete client.s.options[Symbol.for('@@mdb.skipPingOnConnect')];
    }
  }

  await next();
}

async function withSession(context: Record<string, any>, next: any) {
  const { client } = context;
  const { topology } = client;
  if (topology.shouldCheckForSessionSupport()) {
    await topology.selectServerAsync(ReadPreference.primaryPreferred, {});
  }

  const { operation } = context;

  // The driver sessions spec mandates that we implicitly create sessions for operations
  // that are not explicitly provided with a session.
  let session = operation.session;
  let owner: symbol | undefined;
  if (topology.hasSessionSupport()) {
    if (session == null) {
      owner = Symbol();
      session = client.startSession({ owner, explicit: false });
    } else if (session.hasEnded) {
      throw new MongoExpiredSessionError('Use of expired sessions is not permitted');
    } else if (session.snapshotEnabled && !topology.capabilities.supportsSnapshotReads) {
      throw new MongoCompatibilityError('Snapshot reads require MongoDB 5.0 or later');
    }
  } else {
    // no session support
    if (session && session.explicit) {
      // If the user passed an explicit session and we are still, after server selection,
      // trying to run against a topology that doesn't support sessions we error out.
      throw new MongoCompatibilityError('Current topology does not support sessions');
    } else if (session && !session.explicit) {
      // We do not have to worry about ending the session because the server session has not been acquired yet
      delete operation.options.session;
      operation.clearSession();
      session = undefined;
    }
  }

  const readPreference = operation.readPreference ?? ReadPreference.primary;
  const inTransaction = !!session?.inTransaction();

  if (inTransaction && !readPreference.equals(ReadPreference.primary)) {
    throw new MongoTransactionError(
      `Read preference in a transaction must be primary, not: ${readPreference.mode}`
    );
  }

  if (session?.isPinned && session.transaction.isCommitted && !operation.bypassPinningCheck) {
    session.unpin();
  }

  context.session = session;
  context.owner = owner;
  context.readPreference = readPreference;
  context.inTransaction = inTransaction;

  try {
    await next();
  } finally {
    if (session?.owner != null && session.owner === owner) {
      await session.endSession().catch(() => null);
    }
  }
}

async function withServer(context: Record<string, any>, next: any) {
  const { operation, readPreference, session, client } = context;
  const { topology } = client;
  let selector: ReadPreference | ServerSelector;

  if (operation.hasAspect(Aspect.MUST_SELECT_SAME_SERVER)) {
    // GetMore and KillCursor operations must always select the same server, but run through
    // server selection to potentially force monitor checks if the server is
    // in an unknown state.
    selector = sameServerSelector(operation.server?.description);
  } else if (operation.trySecondaryWrite) {
    // If operation should try to write to secondary use the custom server selector
    // otherwise provide the read preference.
    selector = secondaryWritableServerSelector(topology.commonWireVersion, readPreference);
  } else {
    selector = readPreference;
  }

  const server = await topology.selectServerAsync(selector, { session });

  context.server = server;
  context.selector = selector;

  await next();
}

async function withRetryability(context: Record<string, any>, next: any) {
  const { session, server, inTransaction, operation, selector, client } = context;
  const { topology } = client;
  if (topology == null) {
    throw new MongoRuntimeError('client.connect did not create a topology but also did not throw');
  }

  if (session == null) {
    // No session also means it is not retryable, early exit
    await next();
    return;
  }

  if (!operation.hasAspect(Aspect.RETRYABLE)) {
    // non-retryable operation, early exit
    await next();
    return;
  }

  const willRetryRead = topology.s.options.retryReads && !inTransaction && operation.canRetryRead;

  const willRetryWrite =
    topology.s.options.retryWrites &&
    !inTransaction &&
    supportsRetryableWrites(server) &&
    operation.canRetryWrite;

  const hasReadAspect = operation.hasAspect(Aspect.READ_OPERATION);
  const hasWriteAspect = operation.hasAspect(Aspect.WRITE_OPERATION);
  const willRetry = (hasReadAspect && willRetryRead) || (hasWriteAspect && willRetryWrite);

  if (hasWriteAspect && willRetryWrite) {
    operation.options.willRetryWrite = true;
    session.incrementTransactionNumber();
  }

  try {
    await next();
  } catch (operationError) {
    console.error('caught ', operationError);
    if (willRetry && operationError instanceof MongoError) {
      const isWriteOperation = operation.hasAspect(Aspect.WRITE_OPERATION);
      const isReadOperation = operation.hasAspect(Aspect.READ_OPERATION);

      if (isWriteOperation && operationError.code === MMAPv1_RETRY_WRITES_ERROR_CODE) {
        throw new MongoServerError({
          message: MMAPv1_RETRY_WRITES_ERROR_MESSAGE,
          errmsg: MMAPv1_RETRY_WRITES_ERROR_MESSAGE,
          operationError
        });
      }

      if (isWriteOperation && !isRetryableWriteError(operationError)) {
        throw operationError;
      }

      if (isReadOperation && !isRetryableReadError(operationError)) {
        throw operationError;
      }

      if (
        operationError instanceof MongoNetworkError &&
        session.isPinned &&
        !session.inTransaction() &&
        operation.hasAspect(Aspect.CURSOR_CREATING)
      ) {
        // If we have a cursor and the initial command fails with a network error,
        // we can retry it on another connection. So we need to check it back in, clear the
        // pool for the service id, and retry again.
        session.unpin({ force: true, forceClear: true });
      }

      // select a new server, and attempt to retry the operation
      const server = await topology.selectServerAsync(selector, { session });

      if (isWriteOperation && !supportsRetryableWrites(server)) {
        throw new MongoUnexpectedServerResponseError(
          'Selected server does not support retryable writes'
        );
      }

      try {
        console.log('trying again');
        await next();
      } catch (retryError) {
        if (
          retryError instanceof MongoError &&
          retryError.hasErrorLabel(MongoErrorLabel.NoWritesPerformed)
        ) {
          throw operationError;
        }
        throw retryError;
      }
    }
    throw operationError;
  }
}

async function runCommand(context: Record<string, any>) {
  const { operation, server, session } = context;
  const result = await operation.executeAsync(server, session);
  context.result = result;
}

const execute = pipe(withConnectedClient, withSession, withServer, withRetryability, runCommand);

type ResultTypeFromOperation<TOperation> = TOperation extends AbstractOperation<infer K>
  ? K
  : never;

/** @internal */
export interface ExecutionResult {
  /** The server selected for the operation */
  server: Server;
  /** The session used for this operation, may be implicitly created */
  session?: ClientSession;
  /** The raw server response for the operation */
  response: Document;
}

/**
 * Executes the given operation with provided arguments.
 * @internal
 *
 * @remarks
 * This method reduces large amounts of duplication in the entire codebase by providing
 * a single point for determining whether callbacks or promises should be used. Additionally
 * it allows for a single point of entry to provide features such as implicit sessions, which
 * are required by the Driver Sessions specification in the event that a ClientSession is
 * not provided
 *
 * @param topology - The topology to execute this operation on
 * @param operation - The operation to execute
 * @param callback - The command result callback
 */
export function executeOperation<
  T extends AbstractOperation<TResult>,
  TResult = ResultTypeFromOperation<T>
>(client: MongoClient, operation: T): Promise<TResult>;
export function executeOperation<
  T extends AbstractOperation<TResult>,
  TResult = ResultTypeFromOperation<T>
>(client: MongoClient, operation: T, callback: Callback<TResult>): void;
export function executeOperation<
  T extends AbstractOperation<TResult>,
  TResult = ResultTypeFromOperation<T>
>(client: MongoClient, operation: T, callback?: Callback<TResult>): Promise<TResult> | void;
export function executeOperation<
  T extends AbstractOperation<TResult>,
  TResult = ResultTypeFromOperation<T>
>(client: MongoClient, operation: T, callback?: Callback<TResult>): Promise<TResult> | void {
  return maybeCallback(() => executeOperationAsync(client, operation), callback);
}

async function executeOperationAsync<
  T extends AbstractOperation<TResult>,
  TResult = ResultTypeFromOperation<T>
>(client: MongoClient, operation: T): Promise<TResult> {
  if (!(operation instanceof AbstractOperation)) {
    // TODO(NODE-3483): Extend MongoRuntimeError
    throw new MongoRuntimeError('This method requires a valid operation instance');
  }

  const context = {
    client,
    operation
  };

  await execute(context, undefined);
  return context.result;
}
