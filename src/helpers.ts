import { Callback, List } from "./utils";


export function defineHelpers() {
	(Symbol as any).dispose ??= Symbol("Symbol.dispose");
	(Symbol as any).asyncDispose ??= Symbol("Symbol.asyncDispose");
}

export class DisposableStack {
	private stack = new List<Callback>();

	defer(cb: Callback<void>) {
		this.stack.push(cb);
	}

	[Symbol.dispose]() {
		const errors = [];
		while (this.stack.length) {
			const cb = this.stack.shift();
			try {
				cb();
			} catch (error) {
				errors.push(error);
			}
		}

		if (errors.length) {
			throw new AggregateError(errors, 'error disposing DisposableStack')
		}
	}
}
