/**
 * Main entry point for Bento engine
 * Defines global bento namespace, use bento.require and define.
 * Require/define uses RequireJS.
 * @name bento
 */
(function () {
    'use strict';
    var startWatching = false,
        modules = [],
        rjs = window.requirejs, // cache requirejs
        req = window.require, // cache requirejs
        def = window.define, // cache requirejs
        bento = {
            /**
             * Loads modules asynchronously
             * @function
             * @instance
             * @param {Array} dependencyModuleNames - Array of module names
             * @param {Function} callback - Called when dependencies are loaded.
             * Function parameters is a list of corresponding module objects
             * @name bento require
             */
            require: req,
            /**
             * Defines a new module
             * @function
             * @instance
             * @param {String} name - Name of the module
             * @param {Array} dependencyModuleNames - Array of module names
             * @param {Function} callback - Called when dependencies are loaded.
             * Function parameters is a list of corresponding module objects
             * @name bento define
             */
            define: function () {
                var name = arguments[0];
                if (startWatching) {
                    modules.push(name);
                }
                def.apply(this, arguments);
            },
            /**
             * Unwatches specific modules
             * @function
             * @instance
             * @param {Array/Object} mods - Array of module names, or a singular module
             * @name bento unwatchModules
             */
            unwatchModules: function (_modules) {
                //make it an array if it isn't because i'm lazy
                if (!Array.isArray(_modules)) {
                    _modules = [_modules];
                }
                // remove everything on this list from the list to be undefined
                _modules.forEach(function (_module) {
                    var moduleIndex = _modules.indexOf(_module);
                    if (moduleIndex !== -1) {
                        modules.splice(moduleIndex, 1);
                    }
                });
            },
            /*
             * Deletes all loaded modules. See {@link http://requirejs.org/docs/api.html#undef}
             * Modules loaded after bento.watch started are affected
             * @function
             * @instance
             * @name bento.refresh
             */
            refresh: function () {
                var i = 0;
                // undefines every module loaded since watch started
                for (i = 0; i < modules.length; ++i) {
                    rjs.undef(modules[i]);
                }
            },
            /*
             * Start collecting modules for deletion
             * @function
             * @instance
             * @name bento.watch
             */
            watch: function () {
                startWatching = true;
            }
        };

    // add global name
    window.bento = window.bento || bento;

    // undefine global define and require, in case it clashes with other require systems
    window.require = undefined;
    window.define = undefined;
}());
if (!bento) {
    // if bento still isn't defined at this point, then window isn't the global object
    var bento = window.bento;
}