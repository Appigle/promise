'use strict';  // Enable strict mode for better error catching and performance

// This file extends the core Promise implementation with ES6 features

// Import the core Promise implementation
var Promise = require('./core.js');

// Export the enhanced Promise implementation
module.exports = Promise;

/* Static Functions */

// Create pre-cached Promise instances for common values to improve performance
var TRUE = valuePromise(true);         // Cached Promise resolving to true
var FALSE = valuePromise(false);       // Cached Promise resolving to false
var NULL = valuePromise(null);         // Cached Promise resolving to null
var UNDEFINED = valuePromise(undefined);// Cached Promise resolving to undefined
var ZERO = valuePromise(0);            // Cached Promise resolving to 0
var EMPTYSTRING = valuePromise('');    // Cached Promise resolving to empty string

// Helper function to create a pre-resolved Promise with a given value
function valuePromise(value) {
  var p = new Promise(Promise._noop);  // Create new Promise with empty function
  p._state = 1;                        // Set state to fulfilled (1)
  p._value = value;                    // Store the value
  return p;
}

// Implementation of Promise.resolve()
Promise.resolve = function (value) {
  // If value is already a Promise, return it directly
  if (value instanceof Promise) return value;

  // Return cached Promises for common values
  if (value === null) return NULL;
  if (value === undefined) return UNDEFINED;
  if (value === true) return TRUE;
  if (value === false) return FALSE;
  if (value === 0) return ZERO;
  if (value === '') return EMPTYSTRING;

  // Handle thenable objects (objects with a 'then' method)
  if (typeof value === 'object' || typeof value === 'function') {
    try {
      var then = value.then;
      // If object has a 'then' method, treat it as a Promise
      if (typeof then === 'function') {
        return new Promise(then.bind(value));
      }
    } catch (ex) {
      // If accessing .then throws, reject the Promise with the error
      return new Promise(function (resolve, reject) {
        reject(ex);
      });
    }
  }
  // For all other values, create a new resolved Promise
  return valuePromise(value);
};

// Helper function to convert iterables to arrays
var iterableToArray = function (iterable) {
  // Use Array.from if available (ES2015+)
  if (typeof Array.from === 'function') {
    iterableToArray = Array.from;
    return Array.from(iterable);
  }

  // Fallback for ES5: convert array-like objects to arrays
  iterableToArray = function (x) { return Array.prototype.slice.call(x); };
  return Array.prototype.slice.call(iterable);
}

// Implementation of Promise.all()
Promise.all = function (arr) {
  var args = iterableToArray(arr);  // Convert input to array

  return new Promise(function (resolve, reject) {
    // If empty array, resolve immediately with empty array
    if (args.length === 0) return resolve([]);
    
    var remaining = args.length;  // Counter for pending Promises
    
    // Helper function to handle Promise resolution
    function res(i, val) {
      // Handle Promise-like objects
      if (val && (typeof val === 'object' || typeof val === 'function')) {
        // If it's a Promise instance
        if (val instanceof Promise && val.then === Promise.prototype.then) {
          // Handle Promise chaining
          while (val._state === 3) {  // While Promise is adopted
            val = val._value;
          }
          // If Promise is fulfilled, process its value
          if (val._state === 1) return res(i, val._value);
          // If Promise is rejected, reject the entire Promise.all
          if (val._state === 2) reject(val._value);
          // Otherwise, wait for Promise to settle
          val.then(function (val) {
            res(i, val);
          }, reject);
          return;
        } else {
          // Handle thenable objects
          var then = val.then;
          if (typeof then === 'function') {
            var p = new Promise(then.bind(val));
            p.then(function (val) {
              res(i, val);
            }, reject);
            return;
          }
        }
      }
      // Store resolved value and check if all Promises are done
      args[i] = val;
      if (--remaining === 0) {
        resolve(args);
      }
    }
    // Process each item in the input array
    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

// Helper functions for Promise.allSettled()
function onSettledFulfill(value) {
  return { status: 'fulfilled', value: value };
}
function onSettledReject(reason) {
  return { status: 'rejected', reason: reason };
}

// Helper function to map values for allSettled
function mapAllSettled(item) {
  if(item && (typeof item === 'object' || typeof item === 'function')){
    if(item instanceof Promise && item.then === Promise.prototype.then){
      return item.then(onSettledFulfill, onSettledReject);
    }
    var then = item.then;
    if (typeof then === 'function') {
      return new Promise(then.bind(item)).then(onSettledFulfill, onSettledReject)
    }
  }
  return onSettledFulfill(item);
}

// Implementation of Promise.allSettled()
Promise.allSettled = function (iterable) {
  return Promise.all(iterableToArray(iterable).map(mapAllSettled));
};

// Implementation of Promise.reject()
Promise.reject = function (value) {
  return new Promise(function (resolve, reject) {
    reject(value);
  });
};

// Implementation of Promise.race()
Promise.race = function (values) {
  return new Promise(function (resolve, reject) {
    iterableToArray(values).forEach(function(value){
      Promise.resolve(value).then(resolve, reject);
    });
  });
};

/* Prototype Methods */

// Implementation of catch() method
Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};

// Helper function to create AggregateError for Promise.any()
function getAggregateError(errors){
  if(typeof AggregateError === 'function'){
    return new AggregateError(errors,'All promises were rejected');
  }

  var error = new Error('All promises were rejected');
  error.name = 'AggregateError';
  error.errors = errors;
  return error;
}

// Implementation of Promise.any()
Promise.any = function promiseAny(values) {
  return new Promise(function(resolve, reject) {
    var promises = iterableToArray(values);
    var hasResolved = false;
    var rejectionReasons = [];

    // Helper function to resolve only once
    function resolveOnce(value) {
      if (!hasResolved) {
        hasResolved = true;
        resolve(value);
      }
    }

    // Helper function to track rejections
    function rejectionCheck(reason) {
      rejectionReasons.push(reason);
      // If all promises rejected, reject with AggregateError
      if (rejectionReasons.length === promises.length) {
        reject(getAggregateError(rejectionReasons));
      }
    }

    // Handle empty input array
    if(promises.length === 0){
      reject(getAggregateError(rejectionReasons));
    } else {
      // Process each promise
      promises.forEach(function(value){
        Promise.resolve(value).then(resolveOnce, rejectionCheck);
      });
    }
  });
};
