/**
 * Sorted EventSystem is EventSystem's "little brother". It's functionality is the same as
 * EventSystem, except you can pass a component to the event listener. The event listener will then
 * be sorted by which component is visually "on top". Sorted EventSystem will listen to events fired by
 * the normal EventSystem. Recommended to use this only when you need to.
 * <br>Exports: Object
 * @module bento/sortedeventsystem
 */
bento.define('bento/sortedeventsystem', [
    'bento',
    'bento/eventsystem',
    'bento/utils'
], function (
    Bento,
    EventSystem,
    Utils
) {
    // sorting data class: its purpose is to cache variables useful for sorting
    var SortingData = function (component) {
        var rootIndex = -1; // index of root parent in object manager
        var componentIndex = -1; // index of component in entity
        var depth = -1; // how many grandparents
        var parent = component.parent; // component's direct parent
        var parentIndex = -1;
        var parents = [];
        var rootParent = null;
        var rootZ;

        // init objects if needed
        if (objects === null) {
            objects = Bento.objects.getObjects();
        }

        if (!parent) {
            // either the component itself a rootParent, or it wasn't attached yet
            rootParent = component;
        } else {
            // get index of component
            componentIndex = component.rootIndex;
            // grandparent?
            if (parent.parent) {
                parentIndex = parent.rootIndex;
            }

            // find the root
            while (parent) {
                parents.unshift(parent);
                depth += 1;
                if (!parent.parent) {
                    // current parent must be the root
                    rootParent = parent;
                }
                // next iteration
                parent = parent.parent;
            }
        }

        // collect data
        rootIndex = rootParent.rootIndex;
        rootZ = rootParent.z;

        this.isDirty = false;
        this.component = component;
        this.parent = parent;
        this.parentIndex = parentIndex;
        this.parents = parents;
        this.componentIndex = componentIndex;
        this.depth = depth;
        this.rootParent = rootParent;
        this.rootIndex = rootIndex;
        this.rootZ = rootZ;
    };

    var isLoopingEvents = 0;
    var objects = null;
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
    var addEventListener = function (component, eventName, callback, context) {
        var sortingData = new SortingData(component);

        if (Utils.isString(component)) {
            Utils.log('ERROR: First parameter of SortedEventSystem.on is the component!');
            return;
        }
        if (Utils.isUndefined(events[eventName])) {
            events[eventName] = [];
        }
        events[eventName].push({
            sortingData: sortingData,
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
    var sortFunction = function (a, b) {
        // sort event listeners by the component location in the scenegraph
        var sortA = a.sortingData;
        var sortB = b.sortingData;
        // refresh sorting data
        if (sortA.isDirty) {
            a.sortingData = new SortingData(sortA.component);
            sortA = a.sortingData;
        }
        if (sortB.isDirty) {
            b.sortingData = new SortingData(sortB.component);
            sortB = b.sortingData;
        }

        // 0. A === B
        if (sortA.component === sortB.component) {
            // no preference.
            return 0;
        }

        // 1. Sort by z
        var zDiff = sortB.rootZ - sortA.rootZ;
        if (zDiff) {
            return zDiff;
        }

        // 2. Same z: sort by index of the root entity
        var rootDiff = sortB.rootIndex - sortA.rootIndex;
        if (rootDiff) {
            // different roots: sort by root
            return rootDiff;
        }

        // 3. Same index: the components must have common (grand)parents, aka in the same scenegraph
        // NOTE: there might be a better way to sort scenegraphs than this
        // 3A. are the components siblings?
        var parentA = sortA.component.parent;
        var parentB = sortB.component.parent;
        if (parentA === parentB) {
            return sortB.componentIndex - sortA.componentIndex;
        }
        // 3B. common grandparent? This should be a pretty common case
        if (parentA && parentB && parentA.parent === parentB.parent) {
            return sortB.parentIndex - sortA.parentIndex;
        }

        // 3C. one of the component's parent entity is a (grand)parent of the other?
        if (sortA.parents.indexOf(sortB.component.parent) >= 0 || sortB.parents.indexOf(sortA.component.parent) >= 0) {
            return sortB.depth - sortA.depth;
        }
        // 3D. last resort: find the earliest common parent and compare their component index
        return findCommonParentIndex(sortA, sortB);
    };
    var findCommonParentIndex = function (sortA, sortB) {
        // used when components have a common parent, but that common parent is not the root
        var parentsA = sortA.parents;
        var parentsB = sortB.parents;
        var min = Math.min(parentsA.length, parentsB.length);
        var i;
        var commonParent = null;
        var componentA;
        var componentB;
        // find the last common parent
        for (i = 0; i < min; ++i) {
            if (parentsA[i] === parentsB[i]) {
                commonParent = parentsA[i];
            } else {
                // we found the last common parent, now we need to compare these children
                componentA = parentsA[i];
                componentB = parentsB[i];
                break;
            }
        }
        if (!commonParent || !commonParent.components) {
            // error: couldn't find common parent
            return 0;
        }
        // compare indices
        return commonParent.components.indexOf(componentB) - commonParent.components.indexOf(componentA);
    };
    var inspectSortingData = function (listeners) {
        // go through all sortingData and check if their z index didnt change in the meantime
        var sortingData;
        var i = 0,
            l = listeners.length;
        for (i = 0; i < l; ++i) {
            sortingData = listeners[i].sortingData;
            if (sortingData.rootZ !== sortingData.rootParent.z) {
                sortingData.isDirty = true;
            }
            // update rootIndex
            sortingData.rootIndex = sortingData.rootParent.rootIndex;
        }
    };
    var sortListeners = function (listeners) {
        // sort the listeners
        Utils.stableSort.inplace(listeners, sortFunction);
    };
    var stopPropagation = false;

    var SortedEventSystem = {
        suppressWarnings: false,
        stopPropagation: function () {
            stopPropagation = true;
        },
        fire: function (eventName, eventData) {
            var i, l, listeners, listener;

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

            // leaving this for debugging purposes
            // if (eventName === 'pointerDown') {
            //     console.log(listeners);
            // }

            // sort before looping through listeners
            inspectSortingData(listeners);
            sortListeners(listeners);

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
         * @param {Object} component - The component as sorting reference
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
        clear: clearEventListeners,
        sortListeners: sortListeners
    };

    // save reference in EventSystem
    EventSystem.SortedEventSystem = SortedEventSystem;


    return SortedEventSystem;
});