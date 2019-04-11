/**
 * Allows you to fire custom events. Catch these events by using EventSystem.on(). Don't forget to turn
 off listeners with EventSystem.off or you will end up with memory leaks and/or unexpected behaviors.
 * Edge case: EventSystem.off will not clear an event if it's called during an event loop. It will take the
 * next opportunity to clear the event.
 * <br>Exports: Object
 * @module bento/eventsystem
 * @moduleName EventSystem
 * @snippet EventSystem.on|snippet
EventSystem.on('${1}', ${2:fn});
 * @snippet EventSystem.off|snippet
EventSystem.off('${1}', ${2:fn});
 * @snippet EventSystem.fire|snippet
EventSystem.fire('${1}', ${2:data});
 */
bento.define('bento/eventsystem', [
    'bento/utils'
], function (Utils) {
    var isLoopingEvents = 0;
    var events = {};
    /*events = {
            [String eventName]: [Array listeners = {callback: Function, context: this}]
        }*/
    var removedEvents = [];
    var cleanEventListeners = function () {
        var i, j, l, listeners, eventName, callback, context;

        if (isLoopingEvents > 0) {
            return;
        }
        for (j = 0, l = removedEvents.length; j < l; ++j) {
            eventName = removedEvents[j].eventName;
            if (removedEvents[j].reset === true) {
                // reset the whole event listener
                events[eventName] = [];
                continue;
            }
            callback = removedEvents[j].callback;
            context = removedEvents[j].context;
            if (Utils.isUndefined(events[eventName])) {
                continue;
            }
            listeners = events[eventName];
            for (i = listeners.length - 1; i >= 0; --i) {
                if (listeners[i].callback === callback) {
                    if (context) {
                        if (listeners[i].context === context) {
                            events[eventName].splice(i, 1);
                            break;
                        }
                    } else {
                        events[eventName].splice(i, 1);
                        break;
                    }
                }
            }
        }
        removedEvents = [];
    };
    var addEventListener = function (eventName, callback, context) {
        if (Utils.isUndefined(events[eventName])) {
            events[eventName] = [];
        }
        events[eventName].push({
            callback: callback,
            context: context
        });
    };
    var removeEventListener = function (eventName, callback, context) {
        var listeners = events[eventName];
        if (!listeners || listeners.length === 0) {
            return;
        }
        removedEvents.push({
            eventName: eventName,
            callback: callback,
            context: context
        });

        if (isLoopingEvents === 0) {
            // can clean immediately
            cleanEventListeners();
        }
    };
    var clearEventListeners = function (eventName) {
        var listeners = events[eventName];
        if (!listeners || listeners.length === 0) {
            return;
        }
        removedEvents.push({
            eventName: eventName,
            reset: true
        });

        if (isLoopingEvents === 0) {
            // can clean immediately
            cleanEventListeners();
        }
    };
    var stopPropagation = false;
    var EventSystem = {
        SortedEventSystem: null,
        /**
         * Ignore warnings
         * @instance
         * @name suppressWarnings
         */
        suppressWarnings: false,
        /**
         * Stops the current event from further propagating
         * @function
         * @instance
         * @name stopPropagation
         */
        stopPropagation: function () {
            stopPropagation = true;
            // also stop propagation of sorted events by calling this
            var SortedEventSystem = EventSystem.SortedEventSystem;
            if (SortedEventSystem) {
                SortedEventSystem.stopPropagation();
            }
        },
        /**
         * Fires an event
         * @function
         * @instance
         * @param {String} eventName - Name of the event
         * @param {Object} [eventData] - Extra data to pass with event
         * @name fire
         */
        fire: function (eventName, eventData) {
            var i, l, listeners, listener;
            // Note: Sorted events are called before unsorted event listeners
            var SortedEventSystem = EventSystem.SortedEventSystem;
            if (SortedEventSystem) {
                SortedEventSystem.fire(eventName, eventData);
            }

            stopPropagation = false;

            // clean up before firing event
            cleanEventListeners();

            if (!Utils.isString(eventName)) {
                eventName = eventName.toString();
            }
            if (Utils.isUndefined(events[eventName])) {
                return;
            }
            listeners = events[eventName];
            isLoopingEvents++;
            for (i = 0, l = listeners.length; i < l; ++i) {
                listener = listeners[i];
                if (listener) {
                    if (listener.context) {
                        listener.callback.apply(listener.context, [eventData]);
                    } else {
                        listener.callback(eventData);
                    }
                } else if (!this.suppressWarnings) {
                    // TODO: this warning appears when event listeners are removed
                    // during another listener being triggered. For example, removing an entity
                    // while that entity was listening to the same event.
                    // In a lot of cases, this is normal... Consider removing this warning?
                    // console.log('Warning: listener is not a function');
                }
                if (stopPropagation) {
                    stopPropagation = false;
                    break;
                }

            }
            isLoopingEvents--;
        },
        addEventListener: addEventListener,
        removeEventListener: removeEventListener,
        /**
         * Callback function
         *
         * @callback Callback
         * @param {Object} eventData - Any data that is passed
         */
        /**
         * Listen to event.
         * @function
         * @instance
         * @param {String} eventName - Name of the event
         * @param {Callback} callback - Callback function.
         * Be careful about adding anonymous functions here, you should consider removing the event listener
         * to prevent memory leaks.
         * @param {Object} [context] - For prototype objects only: if the callback function is a prototype of an object
         you must pass the object instance or "this" here!
         * @name on
         */
        on: addEventListener,
        /**
         * Removes event listener
         * @function
         * @instance
         * @param {String} eventName - Name of the event
         * @param {Callback} callback - Reference to the callback function
         * @param {Object} [context] - For prototype objects only: if the callback function is a prototype of an object
         you must pass the object instance or "this" here!
         * @name off
         */
        off: removeEventListener,
        /**
         * Removes all listeners of an event
         * @function
         * @instance
         * @param {String} eventName - Name of the event
         * @name clear
         */
        clear: clearEventListeners
    };

    return EventSystem;
});