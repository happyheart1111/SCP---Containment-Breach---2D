// ============================================================
// fsm.js — 通用有限状态机
// ============================================================

class FSM {
  constructor(initialState, states) {
    this.currentState = initialState;
    this.states = states || {};
    this.stateTimer = 0;
    this.previousState = null;
  }

  addState(name, handlers) {
    this.states[name] = handlers;
  }

  update(dt, context) {
    const state = this.states[this.currentState];
    if (!state) return;

    this.stateTimer += dt;

    if (state.update) state.update(dt, context, this);
  }

  changeState(newState, context) {
    if (newState === this.currentState) return;
    const old = this.states[this.currentState];
    if (old && old.exit) old.exit(context, this);

    this.previousState = this.currentState;
    this.currentState = newState;
    this.stateTimer = 0;

    const next = this.states[newState];
    if (next && next.enter) next.enter(context, this);
  }

  revert(context) {
    if (this.previousState) this.changeState(this.previousState, context);
  }

  get state() { return this.currentState; }
  get timeInState() { return this.stateTimer; }
}
