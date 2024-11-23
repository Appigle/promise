'use strict';

// Import asap for handling asynchronous operations
var asap = require('asap/raw');

// Empty function used as a default callback
function noop() {}

// States explanation:
// 0 - pending: initial state, not fulfilled or rejected
// 1 - fulfilled: operation completed successfully
// 2 - rejected: operation failed
// 3 - adopted: this promise adopted state of another promise
// Once state changes from pending, it cannot be changed (immutable)

// Error handling utilities to avoid try/catch in critical functions
var LAST_ERROR = null;  // Stores the last error that occurred
var IS_ERROR = {};      // Special marker object to indicate error state

// Safely get the 'then' method from an object
function getThen(obj) {
  try {
    return obj.then;
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

// Safely call a function with one argument
function tryCallOne(fn, a) {
  try {
    return fn(a);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

// Safely call a function with two arguments
function tryCallTwo(fn, a, b) {
  try {
    fn(a, b);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

module.exports = Promise;

// Promise constructor
function Promise(fn) {
  // Ensure Promise is constructed with 'new'
  if (typeof this !== 'object') {
    throw new TypeError('Promises must be constructed via new');
  }
  // Ensure argument is a function
  if (typeof fn !== 'function') {
    throw new TypeError('Promise constructor\'s argument is not a function');
  }
  
  // Initialize Promise state
  this._deferredState = 0;  // Tracks number of deferred objects
  this._state = 0;          // Promise state (pending, fulfilled, rejected, adopted)
  this._value = null;       // Value/reason of the promise
  this._deferreds = null;   // Queue of deferreds
  
  // Skip resolution for noop executor
  if (fn === noop) return;
  doResolve(fn, this);
}

// Static properties for debugging and special cases
Promise._onHandle = null;   // Called when promise is handled
Promise._onReject = null;   // Called when promise is rejected
Promise._noop = noop;       // Reference to noop function

// Implementation of Promise.prototype.then
Promise.prototype.then = function(onFulfilled, onRejected) {
  // Handle promises from other implementations
  if (this.constructor !== Promise) {
    return safeThen(this, onFulfilled, onRejected);
  }
  
  // Create new promise for chaining
  var res = new Promise(noop);
  handle(this, new Handler(onFulfilled, onRejected, res));
  return res;
};

// Safe version of then for non-native promises
function safeThen(self, onFulfilled, onRejected) {
  return new self.constructor(function (resolve, reject) {
    var res = new Promise(noop);
    res.then(resolve, reject);
    handle(self, new Handler(onFulfilled, onRejected, res));
  });
}

// Core promise resolution procedure
function handle(self, deferred) {
  // Handle promise adoption chain
  while (self._state === 3) {
    self = self._value;
  }
  
  // Notify handler if registered
  if (Promise._onHandle) {
    Promise._onHandle(self);
  }
  
  // Handle pending state
  if (self._state === 0) {
    // Store first deferred
    if (self._deferredState === 0) {
      self._deferredState = 1;
      self._deferreds = deferred;
      return;
    }
    // Store second deferred
    if (self._deferredState === 1) {
      self._deferredState = 2;
      self._deferreds = [self._deferreds, deferred];
      return;
    }
    // Add to deferred array
    self._deferreds.push(deferred);
    return;
  }
  
  // Handle resolved/rejected state
  handleResolved(self, deferred);
}

// Handle resolved promises
function handleResolved(self, deferred) {
  asap(function() {
    // Get appropriate callback (onFulfilled or onRejected)
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
    
    // If no callback, propagate value/reason
    if (cb === null) {
      if (self._state === 1) {
        resolve(deferred.promise, self._value);
      } else {
        reject(deferred.promise, self._value);
      }
      return;
    }
    
    // Call callback and handle result
    var ret = tryCallOne(cb, self._value);
    if (ret === IS_ERROR) {
      reject(deferred.promise, LAST_ERROR);
    } else {
      resolve(deferred.promise, ret);
    }
  });
}

// Resolve promise with value
function resolve(self, newValue) {
  // Cannot resolve promise with itself
  if (newValue === self) {
    return reject(
      self,
      new TypeError('A promise cannot be resolved with itself.')
    );
  }
  
  // Handle thenable objects/functions
  if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
    var then = getThen(newValue);
    if (then === IS_ERROR) {
      return reject(self, LAST_ERROR);
    }
    
    // Adopt state if resolving with a Promise
    if (then === self.then && newValue instanceof Promise) {
      self._state = 3;
      self._value = newValue;
      finale(self);
      return;
    } 
    // Handle other thenables
    else if (typeof then === 'function') {
      doResolve(then.bind(newValue), self);
      return;
    }
  }
  
  // Resolve with value
  self._state = 1;
  self._value = newValue;
  finale(self);
}

// Reject promise with reason
function reject(self, newValue) {
  self._state = 2;
  self._value = newValue;
  if (Promise._onReject) {
    Promise._onReject(self, newValue);
  }
  finale(self);
}

// Process all deferred handlers
function finale(self) {
  // Handle single deferred
  if (self._deferredState === 1) {
    handle(self, self._deferreds);
    self._deferreds = null;
  }
  // Handle multiple deferreds
  if (self._deferredState === 2) {
    for (var i = 0; i < self._deferreds.length; i++) {
      handle(self, self._deferreds[i]);
    }
    self._deferreds = null;
  }
}

// Handler class for managing callbacks
function Handler(onFulfilled, onRejected, promise) {
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.promise = promise;
}

/**
 * Ensures resolver function only calls resolve/reject once
 * Makes no guarantees about asynchrony
 */
function doResolve(fn, promise) {
  var done = false;
  var res = tryCallTwo(fn, function (value) {
    if (done) return;
    done = true;
    resolve(promise, value);
  }, function (reason) {
    if (done) return;
    done = true;
    reject(promise, reason);
  });
  
  // Handle synchronous errors
  if (!done && res === IS_ERROR) {
    done = true;
    reject(promise, LAST_ERROR);
  }
}
