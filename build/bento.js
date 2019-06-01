/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.9 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.9',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value !== 'string') {
                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i += 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (getOwn(config.pkgs, baseName)) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        normalizedBaseParts = baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = normalizedBaseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = getOwn(config.pkgs, (pkgName = name[0]));
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break;
                                }
                            }
                        }
                    }

                    if (foundMap) {
                        break;
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            var c,
                                pkg = getOwn(config.pkgs, mod.map.id);
                            // For packages, only support config targeted
                            // at the main module.
                            c = pkg ? getOwn(config.config, mod.map.id + '/' + pkg.main) :
                                      getOwn(config.config, mod.map.id);
                            return  c || {};
                        },
                        exports: defined[mod.map.id]
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var map, modId, err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule &&
                                        cjsModule.exports !== undefined &&
                                        //Make sure it is not already the exports value
                                        cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var pkgs = config.pkgs,
                    shim = config.shim,
                    objs = {
                        paths: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (prop === 'map') {
                            if (!config.map) {
                                config.map = {};
                            }
                            mixin(config[prop], value, true, true);
                        } else {
                            mixin(config[prop], value, true);
                        }
                    } else {
                        config[prop] = value;
                    }
                });

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overriden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = getOwn(pkgs, parentModule);
                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

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
/**
 * Bento module, main entry point to game modules and managers. Start the game by using Bento.setup().
 * After this you have access to all Bento managers:<br>
 * • Bento.assets<br>
 * • Bento.audio<br>
 * • Bento.input<br>
 * • Bento.object<br>
 * • Bento.savestate<br>
 * • Bento.screen<br>
 * <br>Exports: Object
 * @module bento
 * @moduleName Bento
 *
 *
 * @snippet Bento.assets|assets
Bento.assets
 * @snippet Bento.objects|objects
Bento.objects
 * @snippet Bento.saveState|saveState
Bento.saveState
 * @snippet Bento.screens|screens
Bento.screens
 * @snippet Bento.audio|audio
Bento.audio
 *
 * @snippet Bento.assets.getJson|Object
Bento.assets.getJson('${1}');
 * @snippet Bento.assets.hasAsset|Boolean
Bento.assets.hasAsset('${1}', '${2:images}')
 * @snippet Bento.assets.load|Load asset group
Bento.assets.load('${1:groupName}', function (error, groupName) {
    // asset group loaded callback
}, function (loaded, total, assetName) {
    // single asset loaded callback
})
 * @snippet Bento.objects.attach|snippet
Bento.objects.attach(${1:entity});
 * @snippet Bento.objects.remove|snippet
Bento.objects.remove(${1:entity});
 * @snippet Bento.objects.get|Entity/Object
Bento.objects.get('${1}', function (${1:entity}) {
    $2
});
 * @snippet Bento.objects.getByFamily|Entity/Object
Bento.objects.getByFamily('${1}', function (array) {$2});
 *
 * @snippet Bento.audio.playSound|snippet
Bento.audio.playSound('sfx_${1}');
 * @snippet Bento.audio.stopSound|snippet
Bento.audio.stopSound('sfx_${1}');
 * @snippet Bento.audio.playMusic|snippet
Bento.audio.playMusic('bgm_${1}');
 * @snippet Bento.audio.stopAllMusic|snippet
Bento.audio.stopAllMusic();
 * @snippet Bento.audio.setVolume|snippet
Bento.audio.setVolume: function (${1:1}, '${2:name}');
 * @snippet Bento.audio.isPlayingMusic|Boolean
Bento.audio.isPlayingMusic: function ('${1:name}');
 *
 * @snippet Bento.saveState.save|snippet
Bento.saveState.save('${1}', ${2:value});
 * @snippet Bento.saveState.load|Value
Bento.saveState.load('${1}', ${2:defaultValue});
 * @snippet Bento.saveState.add|snippet
Bento.saveState.add('${1}', ${2:value});
 *
 * @snippet Bento.screens.show|snippet
Bento.screens.show('screens/${1:name}');
 * @snippet Bento.screens.getCurrentScreen|Screen
Bento.screens.getCurrentScreen();
 *
 */
bento.define('bento', [
    'bento/utils',
    'bento/lib/domready',
    'bento/eventsystem',
    'bento/managers/asset',
    'bento/managers/input',
    'bento/managers/object',
    'bento/managers/audio',
    'bento/managers/screen',
    'bento/managers/savestate',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/renderer',
    'bento/autoresize'
], function (
    Utils,
    DomReady,
    EventSystem,
    AssetManager,
    InputManager,
    ObjectManager,
    AudioManager,
    ScreenManager,
    SaveState,
    Vector2,
    Rectangle,
    Renderer,
    AutoResize
) {
    'use strict';
    var canvas;
    var renderer;
    var bentoSettings;
    var canvasRatio = 0;
    var windowRatio;
    var gameSpeed = 1;
    var canvasScale = {
        x: 1,
        y: 1
    };
    var smoothing = true;
    var dev = false;
    var gameData = {};
    var viewport = new Rectangle(0, 0, 640, 480);
    /**
     * Set up canvas element if it doesn't exist
     */
    var setupCanvas = function (settings) {
        var parent;
        var pixelSize = settings.pixelSize || 1;

        canvas = settings.canvasElement || document.getElementById(settings.canvasId);

        if (!canvas) {
            // no canvas, create it
            parent = document.getElementById('wrapper');
            if (!parent) {
                // just append it to the document body
                parent = document.body;
            }
            canvas = document.createElement(Utils.isCocoonJS() ? 'screencanvas' : 'canvas');
            canvas.id = settings.canvasId;
            parent.appendChild(canvas);
        }
        canvas.width = viewport.width * pixelSize;
        canvas.height = viewport.height * pixelSize;
        canvasRatio = viewport.height / viewport.width;
    };
    /**
     * Setup renderer (2D context or WebGL)
     */
    var setupRenderer = function (settings, onComplete) {
        var rendererName = settings.renderer;
        settings.renderer = settings.renderer ? settings.renderer.toLowerCase() : 'canvas2d';

        // canvas2d and pixi are reserved names
        if (settings.renderer === 'canvas2d') {
            rendererName = 'bento/renderers/canvas2d';
        } else if (settings.renderer === 'pixi') {
            rendererName = 'bento/renderers/pixi';
        } else if (settings.renderer === 'auto') {
            // auto renderer is deprecated! use canvas2d or pixi
            console.log('WARNING: auto renderer is deprecated. Please use canvas2d or pixi as renderers.');
            rendererName = 'bento/renderers/canvas2d';
        }
        // setup renderer
        new Renderer(rendererName, canvas, settings, function (rend) {
            console.log('Init ' + rend.name + ' as renderer');
            renderer = rend;

            // set anti aliasing after renderer is created
            smoothing = settings.antiAlias;
            Bento.setAntiAlias(smoothing);

            gameData = Bento.getGameData();
            onComplete();
        });
    };
    /**
     * Callback for responsive resizing
     */
    var performResize = function () {
        var viewport = Bento.getViewport();
        var screenSize = Utils.getScreenSize();
        var pixiRenderer;
        var pixelSize = bentoSettings.pixelSize;
        var minWidth = bentoSettings.responsiveResize.minWidth;
        var maxWidth = bentoSettings.responsiveResize.maxWidth;
        var minHeight = bentoSettings.responsiveResize.minHeight;
        var maxHeight = bentoSettings.responsiveResize.maxHeight;
        var lockedRotation = bentoSettings.responsiveResize.lockedRotation;

        // get scaled screen res
        var canvasDimension = new AutoResize(
            minWidth,
            maxWidth,
            minHeight,
            maxHeight,
            lockedRotation
        );

        // we don't have a canvas?
        if (!canvas) {
            return;
        }

        // set canvas and viewport sizes
        canvas.width = canvasDimension.width * pixelSize;
        canvas.height = canvasDimension.height * pixelSize;
        viewport.width = Math.round(canvasDimension.width);
        viewport.height = Math.round(canvasDimension.height);

        // css fit to height
        if (canvas.style) {
            canvas.style.height = screenSize.height + 'px';
            canvas.style.width = (screenSize.height * (viewport.width / viewport.height)) + 'px';
        }

        // log results
        console.log('Screen size: ' + screenSize.width * window.devicePixelRatio + ' x ' + screenSize.height * window.devicePixelRatio);
        console.log('Game Resolution: ' + canvasDimension.width + ' x ' + canvasDimension.height);

        // final settings
        if (renderer) {
            if (renderer.name === 'canvas2d') {
                // prevent the canvas being blurry after resizing
                if (Bento.getAntiAlias() === false) {
                    Bento.setAntiAlias(false);
                }
            } else if (renderer.name === 'pixi') {
                // use the resize function on pixi
                pixiRenderer = Bento.getRenderer().getPixiRenderer();
                pixiRenderer.resize(canvas.width, canvas.height);
            }
        }
        // update input and canvas
        Bento.input.updateCanvas();
        // clear the task id
        resizeTaskId = null;
    };
    var resizeTaskId = null;
    var onResize = function () {
        // start a 100ms timeout, if interupted with a repeat event start over
        if (resizeTaskId != null) {
            window.clearTimeout(resizeTaskId);
        }
        resizeTaskId = window.setTimeout(performResize, 100);
    };
    /**
     * Take screenshots based on events
     * For example pressing a button to take a screenshot, handy for development
     */
    var setScreenshotListener = function (evtName) {
        var takeScreenshot = false;
        // web only
        var downloadImage = function (uri, name) {
            var link = document.createElement("a");
            link.download = name;
            link.href = uri;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        if (navigator.isCocoonJS || window.Windows || window.ejecta) {
            // disable in Cocoon, UWP and Ejecta/tvOS platforms
            return;
        }
        if (!dev) {
            // should be in dev mode to take screenshots (?)
            return;
        }

        EventSystem.on(evtName, function () {
            takeScreenshot = true;
        });
        EventSystem.on('postDraw', function (data) {
            if (takeScreenshot) {
                takeScreenshot = false;
                downloadImage(canvas.toDataURL(), 'screenshot');
            }
        });

    };
    /**
     * Main module
     */
    var Bento = {
        // version is updated by build, edit package.json
        version: '1.2.5',
        /**
         * Setup game. Initializes all Bento managers.
         * @name setup
         * @function
         * @instance
         * @param {Object} settings - settings for the game
         * @param {Object} [settings.assetGroups] - Asset groups to load. Key: group name, value: path to json file. See {@link module:bento/managers/asset#loadAssetGroups}
         * @param {String} settings.renderer - Renderer to use. Defaults to "canvas2d". To use "pixi", include the pixi.js file manually. Make sure to download v3!.
         * @param {Rectangle} settings.canvasDimension - base resolution for the game. Tip: use a bento/autoresize rectangle.
         * @param {Boolean} settings.sortMode - Bento Object Manager sorts objects by their z value. See {@link module:bento/managers/object#setSortMode}
         * @param {Boolean} settings.subPixel - Disable rounding of pixels
         * @param {Number} settings.pixelSize - Defaults to 1. You may resize pixels by setting this value. A kind of cheating with pixelart games.
         * @param {Boolean} settings.preventContextMenu - Stops the context menu from appearing in browsers when using right click
         * @param {Boolean} settings.autoDisposeTextures - Removes all internal textures on screen ends to reduce memory usage
         * @param {Object} settings.responsiveResize - Bento's strategy of resizing to mobile screen sizes. 
         * In case of portrait: Bento locks the  min height and fills the width by aspect ratio until the max width is reached. If min width is reached, the height is then adapted by aspect ratio up to it's defined maximum.
         * @param {Number} settings.responsiveResize.minWidth - Minimum width in portrait.
         * @param {Number} settings.responsiveResize.maxWidth - Maximum width in portrait.
         * @param {Number} settings.responsiveResize.minHeight - Minimum height in portrait.
         * @param {Number} settings.responsiveResize.maxHeight - Maximum height in portrait.
         * @param {String} settings.responsiveResize.lockedRotation - 'portrait' or 'landscape' enforces an aspect ratio corrseponding to this, instead of handling this automatically, unnecessary to be used if enforcable by another means
         * @param {Object} settings.reload - Settings for module reloading, set the event names for Bento to listen
         * @param {String} settings.reload.simple - Event name for simple reload: reloads modules and resets current screen
         * @param {String} settings.reload.assets - Event name for asset reload: reloads modules and all assets and resets current screen
         * @param {String} settings.reload.jump - Event name for screen jump: asks user to jumps to a screen
         * @param {Boolean} settings.dev - Use dev mode (for now it's only used for deciding between using throws or console.log's). Optional, default is false.
         * @param {Object} settings.screenshot - Event name for taking screenshots
         * @param {Function} settings.onComplete - Called when game is loaded
         */
        setup: function (settings, callback) {
            callback = callback || settings.onComplete || settings.onLoad;
            bentoSettings = settings;
            settings.pixelSize = settings.pixelSize || 1;
            settings.sortMode = settings.sortMode || 0;
            DomReady(function () {
                var runGame = function () {
                    Bento.objects.run();
                    if (callback) {
                        callback();
                    }
                };
                if (settings.canvasDimension) {
                    if (settings.canvasDimension.isRectangle) {
                        viewport = settings.canvasDimension || viewport;
                    } else {
                        throw 'settings.canvasDimension must be a rectangle';
                    }
                }
                setupCanvas(settings);
                setupRenderer(settings, function () {
                    dev = settings.dev || false;
                    Utils.setDev(dev);
                    if (settings.responsiveResize) {
                        if (settings.responsiveResize === true) {
                            settings.responsiveResize = {};
                        }
                        settings.responsiveResize.landscape = settings.responsiveResize.landscape || false;
                        settings.responsiveResize.minWidth = settings.responsiveResize.minWidth || 180;
                        settings.responsiveResize.maxWidth = settings.responsiveResize.maxWidth || 240;
                        settings.responsiveResize.minHeight = settings.responsiveResize.minHeight || 320;
                        settings.responsiveResize.maxHeight = settings.responsiveResize.maxHeight || 390;

                        window.addEventListener('resize', onResize, false);
                        window.addEventListener('orientationchange', onResize, false);
                        onResize();
                    }

                    Bento.input = new InputManager(gameData, settings);
                    Bento.objects = new ObjectManager(Bento.getGameData, settings);
                    Bento.assets = new AssetManager(settings);
                    Bento.audio = new AudioManager(Bento);
                    Bento.screens = new ScreenManager(settings);

                    // mix functions
                    Utils.extend(Bento, Bento.objects);

                    if (settings.assetGroups) {
                        Bento.assets.loadAssetGroups(settings.assetGroups, runGame);
                    } else if (window.assetsJson) {
                        // if there is an inline assets.json, load that
                        Bento.assets.loadInlineAssetsJson();
                        runGame();
                    } else {
                        // try loadings assets.json from the root folder
                        Bento.assets.loadAssetsJson(function (error) {
                            runGame();
                        });
                    }
                    // start watching for new modules
                    bento.watch();
                    // reload keys
                    if (settings.reload && settings.dev) {
                        if (settings.reload.simple) {
                            EventSystem.on(settings.reload.simple, function () {
                                Bento.reload();
                            });
                        }
                        if (settings.reload.assets) {
                            EventSystem.on(settings.reload.assets, function () {
                                Bento.assets.loadAssetsJson(function (error) {
                                    Bento.assets.reload(Bento.reload);
                                });
                            });
                        }
                        if (settings.reload.jump) {
                            EventSystem.on(settings.reload.jump, function () {
                                var res = window.prompt('Show which screen?');
                                Bento.screens.show(res);
                            });
                        }
                    }

                    // screenshot key
                    if (settings.screenshot && settings.dev) {
                        setScreenshotListener(settings.screenshot);
                    }
                });
            });
        },
        /**
         * Returns the settings object supplied to Bento.setup
         * @function
         * @instance
         * @returns Object
         * @name getSettings
         */
        getSettings: function () {
            return bentoSettings;
        },
        /**
         * Returns the current viewport (reference).
         * The viewport is a Rectangle.
         * viewport.x and viewport.y indicate its current position in the world (upper left corner)
         * viewport.width and viewport.height can be used to determine the size of the canvas
         * @function
         * @instance
         * @returns Rectangle
         * @name getViewport
         * @snippet Bento.getViewport|Rectangle
            Bento.getViewport();
         */
        getViewport: function () {
            return viewport;
        },
        /**
         * Returns the canvas element
         * @function
         * @instance
         * @returns HTML Canvas Element
         * @name getCanvas
         */
        getCanvas: function () {
            return canvas;
        },
        /**
         * Returns the current renderer engine
         * @function
         * @instance
         * @returns Renderer
         * @name getRenderer
         */
        getRenderer: function () {
            return renderer;
        },
        /**
         * Reloads modules and jumps to screen. If no screenName was passed,
         * it reloads the current screen.
         * @function
         * @instance
         * @param {String} screenName - screen to show
         * @name reload
         */
        reload: function (screenName) {
            var currentScreen;
            if (!Bento.screens) {
                throw 'Bento has not beens started yet.';
            }
            currentScreen = Bento.screens.getCurrentScreen();

            if (!currentScreen) {
                console.log('WARNING: No screen has been loaded.');
                return;
            }

            Bento.screens.reset();
            Bento.objects.resume();

            Bento.objects.stop();
            bento.refresh();

            // reset game speed
            Bento.objects.throttle = 1;
            gameSpeed = 1;

            // reload current screen
            Bento.screens.show(
                screenName || currentScreen.name,
                undefined,
                function () {
                    // restart the mainloop
                    Bento.objects.run();
                    EventSystem.fire('bentoReload', {});
                }
            );
        },
        /**
         * Returns a gameData object
         * A gameData object is passed through every object during the update and draw
         * and contains all necessary information to render
         * @function
         * @instance
         * @returns {Object} data
         * @returns {HTMLCanvas} data.canvas - Reference to the current canvas element
         * @returns {Renderer} data.renderer - Reference to current Renderer
         * @returns {Vector2} data.canvasScale - Reference to current canvas scale
         * @returns {Rectangle} data.viewport - Reference to viewport object
         * @returns {Entity} data.entity - The current entity passing the data object
         * @returns {Number} data.deltaT - Time passed since last tick
         * @returns {Number} data.throttle - Game speed (1 is normal)
         * @name getGameData
         * @snippet Bento.getGameData|GameData
            Bento.getGameData();
         */
        getGameData: function () {
            var throttle = Bento.objects ? Bento.objects.throttle : 1;
            return {
                canvas: canvas,
                renderer: renderer,
                canvasScale: canvasScale,
                viewport: viewport,
                entity: null,
                event: null,
                deltaT: 0,
                speed: throttle * gameSpeed
            };
        },
        /**
         * Gets the current game speed
         * @function
         * @instance
         * @returns Number
         * @name getGameSpeed
         * @snippet Bento.getGameSpeed|Number
            Bento.getGameSpeed();
         */
        getGameSpeed: function () {
            return gameSpeed;
        },
        /**
         * Sets the current game speed. Defaults to 1.
         * @function
         * @instance
         * @param {Number} speed - Game speed
         * @returns Number
         * @name setGameSpeed
         * @snippet Bento.setGameSpeed|snippet
            Bento.setGameSpeed(${1:1});
         */
        setGameSpeed: function (value) {
            gameSpeed = value;
        },
        /**
         * Is game in dev mode?
         * @function
         * @instance
         * @returns Boolean
         * @name isDev
         */
        isDev: function () {
            return dev;
        },
        /**
         * Set anti alias. On Web platforms with 2d canvas, this settings applies to the main canvas.
         * On Cocoon, this setting applies to any texture that is loaded next.
         * @function
         * @instance
         * @param {Boolean} [antiAliasing] - Set anti aliasing
         * @name setAntiAlias
         * @snippet Bento.setAntiAlias|CanvasElement
        Bento.setAntiAlias(${1:true})
         */
        setAntiAlias: function (antiAlias) {
            var context;
            if (!Utils.isDefined(antiAlias)) {
                // undefined as parameter is ignored
                return;
            }
            smoothing = antiAlias;
            // cocoon only: set antiAlias with smoothing parameter
            if (Utils.isCocoonJs() && window.Cocoon && window.Cocoon.Utils) {
                window.Cocoon.Utils.setAntialias(antiAlias);
            } else if (renderer) {
                // alternatively set on 2d canvas
                context = renderer.getContext();
                if (context && context.canvas) {
                    context.imageSmoothingEnabled = antiAlias;
                    context.webkitImageSmoothingEnabled = antiAlias;
                    context.mozImageSmoothingEnabled = antiAlias;
                    context.msImageSmoothingEnabled = antiAlias;
                }
            }
        },
        /**
         * Get current anti aliasing setting
         * @function
         * @instance
         * @name getAntiAlias
         * @snippet Bento.getAntiAlias|Boolean
        Bento.getAntiAlias()
         */
        getAntiAlias: function () {
            return smoothing;
        },
        /**
         * Wrapper for document.createElement('canvas')
         * @function
         * @instance
         * @param {Boolean} [antiAliasing] - Sets antialiasing (applies to the canvas texture in Cocoon)
         * @name createCanvas
         * @snippet Bento.createCanvas|CanvasElement
        Bento.createCanvas()
         */
        createCanvas: function (antiAlias) {
            var newCanvas;
            var cachedSmoothing = smoothing;

            // apply antialias setting
            if (Utils.isDefined(antiAlias)) {
                Bento.setAntiAlias(antiAlias);
            }
            // create the canvas
            newCanvas = document.createElement('canvas');

            // revert antialias setting
            if (Utils.isDefined(antiAlias)) {
                Bento.setAntiAlias(cachedSmoothing);
            }

            return newCanvas;
        },
        /**
         * Asset manager
         * @see module:bento/managers/asset
         * @instance
         * @name assets
         */
        assets: null,
        /**
         * Object manager
         * @see module:bento/managers/object
         * @instance
         * @name objects
         */
        objects: null,
        /**
         * Input manager
         * @see module:bento/managers/input
         * @instance
         * @name objects
         */
        input: null,
        /**
         * Audio manager
         * @see module:bento/managers/audio
         * @instance
         * @name audio
         */
        audio: null,
        /**
         * Screen manager
         * @see module:bento/managers/screen
         * @instance
         * @name screen
         */
        screens: null,
        /**
         * SaveState manager
         * @see module:bento/managers/savestate
         * @instance
         * @name saveState
         */
        saveState: SaveState,
        utils: Utils
    };
    return Bento;
});
/**
 * Component that helps with detecting clicks on an entity. The component does not detect clicks when the game is paused
 * unless entity.updateWhenPaused is turned on.
 * <br>Exports: Constructor
 * @module bento/components/clickable
 * @moduleName Clickable
 * @snippet Clickable|constructor
Clickable({
    pointerDown: function (data) {},
    pointerUp: function (data) {},
    pointerMove: function (data) {},
    // when clicking on the object
    onClick: function (data) {},
    onClickUp: function (data) {},
    onClickMiss: function (data) {},
    onHold: function (data) {},
    onHoldLeave: function (data) {},
    onHoldEnter: function (data) {},
    onHoldEnd: function (data) {},
    // desktop only
    onHoverLeave: function (data) {},
    onHoverEnter: function (data) {}
})
 * @param {Object} settings - Settings
 * @param {InputCallback} settings.pointerDown - Called when pointer (touch or mouse) is down anywhere on the screen
 * @param {InputCallback} settings.pointerUp - Called when pointer is released anywhere on the screen
 * @param {InputCallback} settings.pointerMove - Called when pointer moves anywhere on the screen
 * @param {InputCallback} settings.onClick - Called when pointer taps on the parent entity
 * @param {InputCallback} settings.onClickUp - The pointer was released above the parent entity
 * @param {InputCallback} settings.onClickMiss - Pointer down but does not touches the parent entity
 * @param {Function} settings.onHold - Called every update tick when the pointer is down on the entity
 * @param {InputCallback} settings.onHoldLeave - Called when pointer leaves the entity
 * @param {InputCallback} settings.onHoldEnter - Called when pointer enters the entity
 * @param {InputCallback} settings.onHoverEnter - Called when mouse hovers over the entity (does not work with touch)
 * @param {InputCallback} settings.onHoverLeave - Called when mouse stops hovering over the entity (does not work with touch)
 * @param {Boolean} settings.sort - Clickable callbacks are executed first if the component/entity is visually on top.
 Other clickables must also have "sort" to true. Otherwise, clickables are executed on creation order.
 * @returns Returns a component object to be attached to an entity.
 */
/**
 * Callback when input changed. The event data is an object that is passed by a source (usually the browser). 
 * The input manager injects some extra info useful for the game.
 *
 * @callback InputCallback
 * @param {Object} evt - Event data object coming from the source
 * @param {Number} evt.id - Touch id (-1 for mouse). Note that touch id can be different for each browser!
 * @param {Vector2} evt.position - position as reported by the source
 * @param {Vector2} evt.worldPosition - position in the world (includes any scrolling)
 * @param {Vector2} evt.localPosition - position relative to the parent entity
 * @param {Vector2} evt.diffPosition - Only when touch ends. Difference position between where the touch started.
 * @param {Vector2} evt.diffWorldPosition - Only when touch ends. Difference position between where the touch started.
 * @param {Vector2} evt.diffLocalPosition - Only when touch ends. Difference position between where the touch started.
 */
bento.define('bento/components/clickable', [
    'bento',
    'bento/utils',
    'bento/math/vector2',
    'bento/math/transformmatrix',
    'bento/eventsystem',
    'bento/sortedeventsystem'
], function (
    Bento,
    Utils,
    Vector2,
    Matrix,
    EventSystem,
    SortedEventSystem
) {
    'use strict';

    var clickables = [];
    var isPaused = function (entity) {
        var rootPause = 0;
        if (!Bento.objects || !entity) {
            return false;
        }
        rootPause = entity.updateWhenPaused;
        // find root parent
        while (entity.parent) {
            entity = entity.parent;
            rootPause = entity.updateWhenPaused;
        }

        return rootPause < Bento.objects.isPaused();
    };

    var isPausedComponent = function (component) {
        return component.updateWhenPaused < Bento.objects.isPaused();
    };

    var Clickable = function (settings) {
        if (!(this instanceof Clickable)) {
            return new Clickable(settings);
        }
        var nothing = null;
        this.entity = null;
        this.parent = null;
        this.rootIndex = -1;
        /**
         * Name of the component
         * @instance
         * @default 'clickable'
         * @name name
         */
        this.name = 'clickable';
        /**
         * Whether the pointer is over the entity
         * @instance
         * @default false
         * @name isHovering
         */
        this.isHovering = false;
        /**
         * Ignore the pause during pointerUp event. If false, the pointerUp event will not be called if the parent entity is paused.
         * This can have a negative side effect in some cases: the pointerUp is never called and your code might be waiting for that.
         * Just make sure you know what you are doing!
         * @instance
         * @default true
         * @name ignorePauseDuringPointerUpEvent
         */
        this.ignorePauseDuringPointerUpEvent = (settings && Utils.isDefined(settings.ignorePauseDuringPointerUpEvent)) ?
            settings.ignorePauseDuringPointerUpEvent : true;
        /**
         * Id number of the pointer holding entity
         * @instance
         * @default null
         * @name holdId
         */
        this.holdId = null;
        this.isPointerDown = false;
        this.initialized = false;
        /**
         * Should the clickable care about (z)order of objects?
         * @instance
         * @default false
         * @name sort
         */
        this.sort = settings.sort || false;
        /**
         * Clickable's updateWhenPaused check.
         * Has higher priority than the entity's updateWhenPaused if non-zero
         * @instance
         * @default false
         * @name updateWhenPaused
         */
        this.updateWhenPaused = settings.updateWhenPaused;

        this.callbacks = {
            pointerDown: settings.pointerDown || nothing,
            pointerUp: settings.pointerUp || nothing,
            pointerMove: settings.pointerMove || nothing,
            // when clicking on the object
            onClick: settings.onClick || nothing,
            onClickUp: settings.onClickUp || nothing,
            onClickMiss: settings.onClickMiss || nothing,
            onHold: settings.onHold || nothing,
            onHoldLeave: settings.onHoldLeave || nothing,
            onHoldEnter: settings.onHoldEnter || nothing,
            onHoldEnd: settings.onHoldEnd || nothing,
            onHoverLeave: settings.onHoverLeave || nothing,
            onHoverEnter: settings.onHoverEnter || nothing
        };
        /**
         * Static array that holds a reference to all currently active Clickables
         * @type {Array}
         */
        this.clickables = clickables;
    };

    Clickable.prototype.destroy = function () {
        var index = clickables.indexOf(this),
            i = 0,
            len = 0;

        if (index > -1)
            clickables[index] = null;
        // clear the array if it consists of only null's
        for (i = 0, len = clickables.length; i < len; ++i) {
            if (clickables[i])
                break;
            if (i === len - 1)
                clickables.length = 0;
        }

        if (this.sort) {
            SortedEventSystem.off('pointerDown', this.pointerDown, this);
            SortedEventSystem.off('pointerUp', this.pointerUp, this);
            SortedEventSystem.off('pointerMove', this.pointerMove, this);
        } else {
            EventSystem.off('pointerDown', this.pointerDown, this);
            EventSystem.off('pointerUp', this.pointerUp, this);
            EventSystem.off('pointerMove', this.pointerMove, this);
        }
        this.initialized = false;
    };
    Clickable.prototype.start = function () {
        if (this.initialized) {
            return;
        }

        clickables.push(this);

        if (this.sort) {
            SortedEventSystem.on(this, 'pointerDown', this.pointerDown, this);
            SortedEventSystem.on(this, 'pointerUp', this.pointerUp, this);
            SortedEventSystem.on(this, 'pointerMove', this.pointerMove, this);
        } else {
            EventSystem.on('pointerDown', this.pointerDown, this);
            EventSystem.on('pointerUp', this.pointerUp, this);
            EventSystem.on('pointerMove', this.pointerMove, this);
        }
        this.initialized = true;
    };
    Clickable.prototype.update = function () {
        if (this.isHovering && this.isPointerDown && this.callbacks.onHold) {
            this.callbacks.onHold();
        }
    };
    Clickable.prototype.cloneEvent = function (evt) {
        return {
            id: evt.id,
            position: evt.position.clone(),
            eventType: evt.eventType,
            localPosition: evt.localPosition.clone(),
            worldPosition: evt.worldPosition.clone(),
            diffPosition: evt.diffPosition ? evt.diffPosition.clone() : undefined
        };
    };
    Clickable.prototype.pointerDown = function (evt) {
        var e;
        var isInActive = this.updateWhenPaused ? isPausedComponent(this) : isPaused(this.entity);
        if (isInActive) {
            return;
        }
        e = this.transformEvent(evt);
        this.isPointerDown = true;
        if (this.callbacks.pointerDown) {
            this.callbacks.pointerDown.call(this, e);
        }
        if (this.entity.getBoundingBox) {
            this.checkHovering.call(this, e, true);
        }
    };
    Clickable.prototype.pointerUp = function (evt) {
        var e;
        var mousePosition;
        var callbacks = this.callbacks;

        // a pointer up could get missed during a pause
        var isInActive = this.updateWhenPaused ? isPausedComponent(this) : isPaused(this.entity);
        if (!this.ignorePauseDuringPointerUpEvent && isInActive) {
            return;
        }
        e = this.transformEvent(evt);
        mousePosition = e.localPosition;
        this.isPointerDown = false;
        if (callbacks.pointerUp) {
            callbacks.pointerUp.call(this, e);
        }
        // onClickUp respects isPaused
        if (this.entity.getBoundingBox().hasPosition(mousePosition) && !isInActive) {
            if (callbacks.onClickUp) {
                callbacks.onClickUp.call(this, e);
            }
            if (this.holdId === e.id) {
                if (callbacks.onHoldEnd) {
                    callbacks.onHoldEnd.call(this, e);
                }
            }
        }
        this.holdId = null;
    };
    Clickable.prototype.pointerMove = function (evt) {
        var e; // don't calculate transformed event until last moment to save cpu
        var callbacks = this.callbacks;
        var isInActive = this.updateWhenPaused ? isPausedComponent(this) : isPaused(this.entity);
        if (isInActive) {
            return;
        }
        if (callbacks.pointerMove) {
            if (!e) {
                e = this.transformEvent(evt);
            }
            callbacks.pointerMove.call(this, e);
        }
        // hovering?
        if (
            this.entity.getBoundingBox &&
            // only relevant if hover callbacks are implmented
            (callbacks.onHoldEnter || callbacks.onHoldLeave || callbacks.onHoverLeave)
        ) {
            if (!e) {
                e = this.transformEvent(evt);
            }
            this.checkHovering.call(this, e);
        }
    };
    Clickable.prototype.checkHovering = function (evt, clicked) {
        var mousePosition = evt.localPosition;
        var callbacks = this.callbacks;
        if (this.entity.getBoundingBox().hasPosition(mousePosition)) {
            if (!this.isHovering && this.holdId === evt.id) {
                if (callbacks.onHoldEnter) {
                    callbacks.onHoldEnter.call(this, evt);
                }
            }
            if (!this.isHovering && callbacks.onHoverEnter) {
                callbacks.onHoverEnter.call(this, evt);
            }
            this.isHovering = true;
            if (clicked) {
                this.holdId = evt.id;
                if (callbacks.onClick) {
                    callbacks.onClick.call(this, evt);
                }
            }
        } else {
            if (this.isHovering && this.holdId === evt.id) {
                if (callbacks.onHoldLeave) {
                    callbacks.onHoldLeave.call(this, evt);
                }
            }
            if (this.isHovering && callbacks.onHoverLeave) {
                callbacks.onHoverLeave.call(this, evt);
            }
            this.isHovering = false;
            if (clicked && callbacks.onClickMiss) {
                callbacks.onClickMiss.call(this, evt);
            }
        }
    };
    /**
     * Whether the clickable is receiving events currently. If the parent entity is paused, the clickable
     * is not active.
     * @function
     * @instance
     * @returns {Boolean} Active state
     * @name isPaused
     */
    Clickable.prototype.isPaused = function () {
        return this.updateWhenPaused ? isPausedComponent(this) : isPaused(this.entity);
    };

    Clickable.prototype.transformEvent = function (evt) {
        evt.localPosition = this.entity.toComparablePosition(evt.worldPosition);
        return evt;
    };
    Clickable.prototype.attached = function (data) {
        this.entity = data.entity;
    };
    Clickable.prototype.toString = function () {
        return '[object Clickable]';
    };

    return Clickable;
});
/**
 * Component that listens to an event fired by the EventSystem.
 * Automatically stops listening if the entity is destroyed or if the component is removed
 * <br>Exports: Constructor
 * @module bento/components/eventlistener
 * @moduleName EventListener
 * @snippet EventListener.snippet
EventListener({
    name: '${1:eventListener}',
    eventName: '${2:eventName}',
    ignorePause: ${3:false},
    onEvent: function (data) {
        $4
    }
})
 * @param {Object} settings - Settings
 * @param {String} settings.name - Component name, defaults to 'eventListener'
 * @param {String} settings.eventName - Event name to listen to
 * @param {Boolean} settings.ignorePause - Listen to events even if entity is paused
 * @param {Function} settings.onEvent - Event callback
 */
bento.define('bento/components/eventlistener', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Entity,
    EventSystem,
    Utils,
    Tween
) {
    'use strict';
    var isPaused = function (entity) {
        var rootPause = 0;
        if (!Bento.objects || !entity) {
            return false;
        }
        rootPause = entity.updateWhenPaused;
        // find root parent
        while (entity.parent) {
            entity = entity.parent;
            rootPause = entity.updateWhenPaused;
        }

        return rootPause < Bento.objects.isPaused();
    };
    return function (settings) {
        var viewport = Bento.getViewport();
        var componentName = settings.name || 'eventListener';
        var eventName = settings.eventName;
        var ignorePause = settings.ignorePause || false;
        var onEvent = settings.callback || settings.onEvent || function () {};
        var entity;
        var component = {
            name: componentName,
            start: function (data) {
                if (!eventName) {
                    Utils.log('WARNING: eventName is not defined! Using component name as event name');
                    eventName = componentName;
                }
                EventSystem.on(eventName, ignorePause ? onEvent : wrapperCallback);
            },
            destroy: function (data) {
                EventSystem.off(eventName, ignorePause ? onEvent : wrapperCallback);
            },
            attached: function (data) {
                entity = data.entity;
            }
        };
        // this callback is used when event listener can pause
        var wrapperCallback = function (data) {
            if (!isPaused(entity)) {
                onEvent(data);
            }
        };
        return component;
    };
});
/**
 * Component that fills a square.
 * <br>Exports: Constructor
 * @module bento/components/fill
 * @moduleName Fill
 * @param {Object} settings - Settings
 * @param {Array} settings.color - Color ([1, 1, 1, 1] is pure white). Alternatively use the Color module.
 * @param {Rectangle} settings.dimension - Size to fill up (defaults to viewport size)
 * @param {Rectangle} settings.origin - Origin point
 * @param {Rectangle} settings.originRelative - Set origin with relative to the dimension
 * @returns Returns a component object to be attached to an entity.
 * @snippet Fill|constructor
Fill({
    name: 'fill',
    dimension: viewport.getSize(),
    color: [${1:0}, ${2:0}, ${3:0}, 1], // [1, 1, 1, 1] is pure white
    originRelative: new Vector2(${4:0}, ${5:0})
})
 */
bento.define('bento/components/fill', [
    'bento/utils',
    'bento',
    'bento/math/vector2'
], function (
    Utils,
    Bento,
    Vector2
) {
    'use strict';
    var Fill = function (settings) {
        if (!(this instanceof Fill)) {
            return new Fill(settings);
        }
        var viewport = Bento.getViewport();
        settings = settings || {};
        this.parent = null;
        this.rootIndex = -1;
        this.name = settings.name || 'fill';
        /**
         * Color array
         * @instance
         * @name color
         * @snippet #Fill.color|Array
            color
         */
        this.color = settings.color || [0, 0, 0, 1];
        while (this.color.length < 4) {
            this.color.push(1);
        }
        /**
         * Dimension/size of the rectangle to fill
         * @instance
         * @name dimension
         * @snippet #Fill.dimension|Rectangle
            dimension
         */
        this.dimension = settings.dimension || settings.size || settings.rectangle || viewport.getSize();
        /**
         * Origin of the fill size
         * @instance
         * @name origin
         * @snippet #Fill.origin|Vector2
            origin
         */
        this.origin = settings.origin || new Vector2(0, 0);
        if (settings.originRelative) {
            this.origin.x = this.dimension.width * settings.originRelative.x;
            this.origin.y = this.dimension.height * settings.originRelative.y;
        }
    };
    Fill.prototype.draw = function (data) {
        // TODO: use pixi graphics
        // var dimension = this.dimension;
        // var origin = this.origin;
        // data.renderer.fillRect(
        //     this.color,
        //     dimension.x - origin.x,
        //     dimension.y - origin.y,
        //     dimension.width,
        //     dimension.height
        // );
    };
    /**
     * Set origin relative to size
     * @instance
     * @function
     * @name setOriginRelative
     * @param {Vector2} originRelative - Vector2 with the origin relative to its dimension
     * @snippet #Fill.setOriginRelative()|snippet
        setOriginRelative(${1:new Vector2(0, 0)})
     */
    Fill.prototype.setOriginRelative = function (originRelative) {
        this.origin.x = this.dimension.width * originRelative.x;
        this.origin.y = this.dimension.height * originRelative.y;
    };
    Fill.prototype.toString = function () {
        return '[object Fill]';
    };

    return Fill;
});
/**
 * Component for modal popups - pauses the game on start and resets on destroy.
 * The parent entity will not be paused. Pauselevels will stack when more entities with the
 * modal component are attached to the game.
 * <br>Exports: Constructor
 * @module bento/components/modal
 * @moduleName Modal
 * @snippet Modal|constructor
Modal({})
 * @snippet Modal|target
Modal({
    pauseLevel: ${1:1}
})
 * @param {Object} settings - Settings
 * @param {String} [settings.pauseLevel] - Target pause level, recommended to ignore this parameter and
 * let the component set the automatic pause level automatically.
 */
bento.define('bento/components/modal', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Entity,
    EventSystem,
    Utils,
    Tween
) {
    'use strict';
    return function (settings) {
        var entity;
        var pauseLevel = settings.pauseLevel; // target pauseLevel
        var oldPauseLevel;
        var component = {
            name: 'modal',
            /*
             * Current pauseLevel
             */
            pauseLevel: 0,
            start: function (data) {
                // set pauselevel to target or current + 1
                oldPauseLevel = Bento.objects.isPaused();

                if (pauseLevel < oldPauseLevel) {
                    pauseLevel = oldPauseLevel + 1;
                    if (!settings.surpressWarnings) {
                        Utils.log('Warning: target pauseLevel (' + settings.pauseLevel +') is lower than current pause (' + oldPauseLevel + ')');
                    }
                }

                component.pauseLevel = pauseLevel || (oldPauseLevel + 1);
                Bento.objects.pause(component.pauseLevel);

                // entity ignores the pause
                entity.updateWhenPaused = component.pauseLevel;
            },
            destroy: function (data) {
                // revert pause
                if (Bento.objects.isPaused() !== component.pauseLevel) {
                    // Utils.log('WARNING: pauseLevel changed while a modal is active. Unexpected behavior might occurr');
                    return;
                }
                Bento.objects.pause(oldPauseLevel);
            },
            attached: function (data) {
                entity = data.entity;
            }
        };
        return component;
    };
});
/**
 * NineSlice component, takes an image and slices it in 9 equal parts. This image can then be stretched as a box
 * where the corners don't get deformed.
 * <br>Exports: Constructor
 * @module bento/components/nineslice
 * @moduleName NineSlice
 * @snippet NineSlice|constructor
NineSlice({
    imageName: '${1}',
    originRelative: new Vector2(${2:0.5}, ${3:0.5}),
    width: ${4:32},
    height: ${5:32}
})
 * @param {Object} settings - Settings
 * @param {String} settings.imageName - (Using image assets) Asset name for the image.
 * @param {Vector2} settings.origin - Vector2 of origin
 * @param {Vector2} settings.originRelative - Vector2 of relative origin (relative to dimension size)
 * @param {Vector2} settings.width - Width of the desired box
 * @param {Vector2} settings.height - Height of the desired box
 * @param {Number} settings.frameCountX - Number of animation frames horizontally (defaults to 1)
 * @param {Number} settings.frameCountY - Number of animation frames vertically (defaults to 1)
 * @param {Number} settings.frameWidth - Alternative for frameCountX, sets the width manually
 * @param {Number} settings.frameHeight - Alternative for frameCountY, sets the height manually
 * @param {Number} settings.paddding - Pixelsize between slices
 * @param {Number} settings.framePaddding - Pixelsize between frames
 * @param {Object} settings.animations - Only needed if an image asset) Object literal defining animations, the object literal keys are the animation names.
 * @param {Boolean} settings.animations[...].loop - Whether the animation should loop (defaults to true)
 * @param {Number} settings.animations[...].backTo - Loop back the animation to a certain frame (defaults to 0)
 * @param {Number} settings.animations[...].speed - Speed at which the animation is played. 1 is max speed (changes frame every tick). (defaults to 1)
 * @param {Array} settings.animations[...].frames - The frames that define the animation. The frames are counted starting from 0 (the top left)
 */
bento.define('bento/components/nineslice', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Entity,
    EventSystem,
    Utils,
    Tween
) {
    'use strict';
    /**
     * Describe your settings object parameters
     * @param {Object} settings
     */
    var NineSlice = function (settings) {
        if (!(this instanceof NineSlice)) {
            return new NineSlice(settings);
        }
        this.entity = null;
        this.parent = null;
        this.rootIndex = -1;
        this.name = 'nineslice';
        this.visible = true;
        this.origin = new Vector2(0, 0);

        // component settings
        this._width = 0;
        this._height = 0;
        this._recalculateFlag = false;
        this.frameX = 0;
        this.frameY = 0;

        // sprite settings
        this.spriteImage = null;
        this.padding = 0;
        this.frameWidth = 0;
        this.frameHeight = 0;
        this.frameCountX = 1;
        this.frameCountY = 1;
        this.framePadding = 0;

        // drawing internals
        this.sliceWidth = 0;
        this.sliceHeight = 0;

        //animation setttings
        this.animations = {};
        this.currentAnimation = null;
        this.currentAnimationLength = 0;
        this.currentFrame = 0;

        this.onCompleteCallback = function () {};

        this.settings = settings;
        this.setup(settings);
    };

    NineSlice.prototype.setup = function (settings) {
        var self = this;

        if (settings.image) {
            this.spriteImage = settings.image;
        } else if (settings.imageName) {
            // load from string
            if (Bento.assets) {
                this.spriteImage = Bento.assets.getImage(settings.imageName);
            } else {
                throw 'Bento asset manager not loaded';
            }
        } else if (settings.imageFromUrl) {
            // load from url
            if (!this.spriteImage && Bento.assets) {
                Bento.assets.loadImageFromUrl(settings.imageFromUrl, settings.imageFromUrl, function (err, asset) {
                    self.spriteImage = Bento.assets.getImage(settings.imageFromUrl);
                    self.setup(settings);

                    if (settings.onLoad) {
                        settings.onLoad();
                    }
                });
                // wait until asset is loaded and then retry
                return;
            }
        } else {
            // no image specified
            return;
        }
        if (!this.spriteImage) {
            Utils.log("ERROR: something went wrong with loading the sprite.");
            return;
        }

        this.padding = settings.padding || 0;
        this.framePadding = settings.framePadding || 0;


        this.frameWidth = this.spriteImage.width;
        this.frameHeight = this.spriteImage.height;

        if (settings.frameWidth) {
            this.frameWidth = settings.frameWidth;
            this.frameCountX = Math.floor(this.spriteImage.width / settings.frameWidth);
        } else if (settings.frameCountX) {
            this.frameCountX = settings.frameCountX;
            this.frameWidth = (this.spriteImage.width - this.framePadding * (this.frameCountX - 1)) / this.frameCountX;
        }
        if (settings.frameHeight) {
            this.frameHeight = settings.frameHeight;
            this.frameCountY = Math.floor(this.spriteImage.width / settings.frameHeight);
        } else if (settings.frameCountY) {
            this.frameCountY = settings.frameCountY;
            this.frameHeight = (this.spriteImage.height - this.framePadding * (this.frameCountY - 1)) / this.frameCountY;
        }

        if (this.spriteImage) {
            this.sliceWidth = Math.floor((this.frameWidth - this.padding * 2) / 3);
            this.sliceHeight = Math.floor((this.frameHeight - this.padding * 2) / 3);
        }

        if (settings.width) {
            this._width = Math.max(settings.width || 0, 0);
        } else if (settings.innerWidth) {
            this._width = this.sliceWidth * 2 + Math.max(settings.innerWidth || 0, 0);
        }

        if (settings.height) {
            this._height = Math.max(settings.height || 0, 0);
        } else if (settings.innerHeight) {
            this._height = this.sliceHeight * 2 + Math.max(settings.innerHeight || 0, 0);
        }

        if (this.settings.origin) {
            this.origin.x = this.settings.origin.x;
            this.origin.y = this.settings.origin.y;
        } else if (this.settings.originRelative) {
            this.setOriginRelative(this.settings.originRelative);
        }

        this.animations = settings.animations || {};
        // add default animation
        if (!this.animations['default']) {
            this.animations['default'] = {
                frames: [0]
            };
        }

        if (this.entity) {
            // set dimension of entity object
            this.entity.dimension.x = -this.origin.x;
            this.entity.dimension.y = -this.origin.y;
            this.entity.dimension.width = this._width;
            this.entity.dimension.height = this._height;
        }
        this.recalculateDimensions();

        this.setAnimation('default');
    };

    NineSlice.prototype.updateEntity = function () {
        if (!this.entity) return;
        // set dimension of entity object
        this.entity.dimension.x = -this.origin.x;
        this.entity.dimension.y = -this.origin.y;
        this.entity.dimension.width = this._width;
        this.entity.dimension.height = this._height;
    };

    NineSlice.prototype.attached = function (data) {
        this.entity = data.entity;

        this.updateEntity();
    };

    NineSlice.prototype.setAnimation = function (name, callback, keepCurrentFrame) {
        var anim = this.animations[name];
        if (!anim) {
            console.log('Warning: animation ' + name + ' does not exist.');
            return;
        }

        if (anim && (this.currentAnimation !== anim || (this.onCompleteCallback !== null && Utils.isDefined(callback)))) {
            if (!Utils.isDefined(anim.loop)) {
                anim.loop = true;
            }
            if (!Utils.isDefined(anim.backTo)) {
                anim.backTo = 0;
            }
            // set even if there is no callback
            this.onCompleteCallback = callback;
            this.currentAnimation = anim;
            this.currentAnimation.name = name;
            this.currentAnimationLength = this.currentAnimation.frames.length;
            if (!keepCurrentFrame) {
                this.currentFrame = 0;
            }
            if (this.currentAnimation.backTo > this.currentAnimationLength) {
                console.log('Warning: animation ' + name + ' has a faulty backTo parameter');
                this.currentAnimation.backTo = this.currentAnimationLength;
            }
        }
    };

    NineSlice.prototype.getAnimationName = function () {
        return this.currentAnimation.name;
    };

    NineSlice.prototype.setFrame = function (frameNumber) {
        this.currentFrame = frameNumber;
    };

    NineSlice.prototype.getCurrentSpeed = function () {
        return this.currentAnimation.speed;
    };

    NineSlice.prototype.setCurrentSpeed = function (value) {
        this.currentAnimation.speed = value;
    };

    NineSlice.prototype.getCurrentFrame = function () {
        return this.currentFrame;
    };

    Object.defineProperty(NineSlice.prototype, 'width', {
        get: function () {
            return this._width;
        },
        set: function (value) {
            this._width = Math.max(value, 0);
            this._recalculateFlag = true;
        }
    });

    Object.defineProperty(NineSlice.prototype, 'height', {
        get: function () {
            return this._height;
        },
        set: function (value) {
            this._height = Math.max(value, 0);
            this._recalculateFlag = true;
        }
    });

    Object.defineProperty(NineSlice.prototype, 'innerWidth', {
        get: function () {
            return Math.max(this._width - this.sliceWidth * 2, 0);
        },
        set: function (value) {
            value -= this.sliceWidth * 2;
            this._width = this.sliceWidth * 2 + Math.max(value, 0);
            this._recalculateFlag = true;
        }
    });

    Object.defineProperty(NineSlice.prototype, 'innerHeight', {
        get: function () {
            return Math.max(this._height - this.sliceHeight * 2, 0);
        },
        set: function (value) {
            value -= this.sliceHeight * 2;
            this._height = this.sliceHeight * 2 + Math.max(value, 0);
            this._recalculateFlag = true;
        }
    });

    /**
     * Sets the origin relatively (0...1), relative to the size of the frame.
     * @function
     * @param {Vector2} origin - Position of the origin (relative to upper left corner)
     * @instance
     * @name setOriginRelative
     */
    NineSlice.prototype.setOriginRelative = function (originRelative) {
        this.origin.x = originRelative.x * this._width;
        this.origin.y = originRelative.y * this._height;
        this.settings.originRelative = originRelative.clone();
    };

    NineSlice.prototype.update = function (data) {
        var reachedEnd;

        if (this._recalculateFlag) {
            this.recalculateDimensions();
        }

        if (!this.currentAnimation) {
            return;
        }

        // no need for update
        if (this.currentAnimationLength <= 1 || this.currentAnimation.speed === 0) {
            return;
        }

        var frameSpeed = this.currentAnimation.speed || 1;
        if (this.currentAnimation.frameSpeeds && this.currentAnimation.frameSpeeds.length - 1 >= this.currentFrame) {
            frameSpeed *= this.currentAnimation.frameSpeeds[Math.floor(this.currentFrame)];
        }

        reachedEnd = false;
        this.currentFrame += (frameSpeed) * data.speed;
        if (this.currentAnimation.loop) {
            while (this.currentFrame >= this.currentAnimation.frames.length) {
                this.currentFrame -= this.currentAnimation.frames.length - this.currentAnimation.backTo;
                reachedEnd = true;
            }
        } else {
            if (this.currentFrame >= this.currentAnimation.frames.length) {
                reachedEnd = true;
            }
        }
        if (reachedEnd && this.onCompleteCallback) {
            this.onCompleteCallback();
            //don't repeat callback on non-looping animations
            if (!this.currentAnimation.loop) {
                this.onCompleteCallback = null;
            }
        }
    };

    NineSlice.prototype.recalculateDimensions = function () {
        this._innerWidth = Math.round(Math.max(0, this._width - this.sliceWidth * 2));
        this._innerHeight = Math.round(Math.max(0, this._height - this.sliceHeight * 2));

        this._leftWidth = Math.min(this.sliceWidth, this._width / 2);
        this.rightWidth = Math.min(this.sliceWidth, this._width - this._leftWidth);

        this._topHeight = Math.min(this.sliceHeight, this._height / 2);
        this._bottomHeight = Math.min(this.sliceHeight, this._height - this._topHeight);

        if (this.settings.originRelative) {
            // recalculate relative origin
            this.origin.x = this.settings.originRelative.x * this._width;
            this.origin.y = this.settings.originRelative.y * this._height;
        }

        if (this.entity) {
            this.updateEntity();
        }

        this._recalculateFlag = false;
    };

    NineSlice.prototype.fillArea = function (renderer, slice, x, y, width, height) {
        var sx = (this.sliceWidth + this.padding) * (slice % 3) + this.frameX;
        var sy = (this.sliceHeight + this.padding) * Math.floor(slice / 3) + this.frameY;

        if (width === 0 || height === 0) {
            return;
        }

        if (!width) {
            width = this.sliceWidth;
        }
        if (!height) {
            height = this.sliceHeight;
        }

        renderer.drawImage(
            this.spriteImage,
            sx,
            sy,
            this.sliceWidth,
            this.sliceHeight,
            x | 0,
            y | 0,
            width,
            height
        );
    };

    NineSlice.prototype.updateFrame = function () {
        var frameIndex = Math.min(Math.floor(this.currentFrame), this.currentAnimation.frames.length - 1);
        var sourceFrame = this.currentAnimation.frames[frameIndex];
        this.frameX = (sourceFrame % this.frameCountX) * (this.frameWidth + this.padding);
        this.frameY = Math.floor(sourceFrame / this.frameCountX) * (this.frameHeight + this.padding);
    };

    NineSlice.prototype.draw = function (data) {
        var entity = data.entity;
        var origin = this.origin;

        if (this._width === 0 || this._height === 0) {
            return;
        }

        this.updateFrame();

        data.renderer.translate(-Math.round(origin.x), -Math.round(origin.y));

        //top left corner
        this.fillArea(data.renderer, 0, 0, 0, this._leftWidth, this._topHeight);
        //top stretch
        this.fillArea(data.renderer, 1, this._leftWidth, 0, this._innerWidth, this._topHeight);
        //top right corner
        this.fillArea(data.renderer, 2, this._width - this.rightWidth, 0, this.rightWidth, this._topHeight);

        //left stretch
        this.fillArea(data.renderer, 3, 0, this._topHeight, this._leftWidth, this._innerHeight);
        //center stretch
        this.fillArea(data.renderer, 4, this._leftWidth, this._topHeight, this._innerWidth, this._innerHeight);
        //right stretch
        this.fillArea(data.renderer, 5, this._width - this.rightWidth, this._topHeight, this.rightWidth, this._innerHeight);

        //bottom left corner
        this.fillArea(data.renderer, 6, 0, this._height - this._bottomHeight, this._leftWidth, this._bottomHeight);
        //bottom stretch
        this.fillArea(data.renderer, 7, this._leftWidth, this._height - this._bottomHeight, this._innerWidth, this._bottomHeight);
        //bottom right corner
        this.fillArea(data.renderer, 8, this._width - this.rightWidth, this._height - this._bottomHeight, this.rightWidth, this._bottomHeight);

        data.renderer.translate(Math.round(origin.x), Math.round(origin.y));
    };

    // Deprecated functions, added for compatibility
    NineSlice.prototype.setWidth = function (value) {
        this.width = value;
    };
    NineSlice.prototype.setHeight = function (value) {
        this.height = value;
    };

    return NineSlice;
});
/**
 * Sprite component with a pixi sprite exposed. Must be used with pixi renderer.
 * Useful if you want to use pixi features.
 * <br>Exports: Constructor
 * @module bento/components/pixi/sprite
 * @moduleName PixiSprite
 * @returns Returns a component object to be attached to an entity.
 */
bento.define('bento/components/pixi/sprite', [
    'bento',
    'bento/utils',
    'bento/components/sprite'
], function (Bento, Utils, Sprite) {
    'use strict';
    var PixiSprite = function (settings) {
        if (!(this instanceof PixiSprite)) {
            return new PixiSprite(settings);
        }
        Sprite.call(this, settings);
        this.sprite = new window.PIXI.Sprite();
        this.scaleMode = settings.scaleMode || (Bento.getAntiAlias() ? window.PIXI.SCALE_MODES.LINEAR : window.PIXI.SCALE_MODES.NEAREST);
    };
    PixiSprite.prototype = Object.create(Sprite.prototype);
    PixiSprite.prototype.constructor = PixiSprite;
    PixiSprite.prototype.draw = function (data) {
        var entity = data.entity;

        if (!this.currentAnimation || !this.visible) {
            return;
        }
        this.updateFrame();
        this.updateSprite(
            this.spriteImage,
            this.sourceX,
            this.sourceY,
            this.frameWidth,
            this.frameHeight
        );

        // draw with pixi
        data.renderer.translate(-Math.round(this.origin.x), -Math.round(this.origin.y));
        data.renderer.drawPixi(this.sprite);
        data.renderer.translate(Math.round(this.origin.x), Math.round(this.origin.y));
    };
    PixiSprite.prototype.updateSprite = function (packedImage, sx, sy, sw, sh) {
        var rectangle;
        var sprite;
        var texture;
        var image;

        if (!packedImage) {
            return;
        }
        image = packedImage.image;
        if (!image.texture) {
            // initialize pixi baseTexture
            image.texture = new window.PIXI.BaseTexture(image, this.scaleMode);
            image.frame = new window.PIXI.Texture(image.texture);
        }
        texture = image.frame;
        rectangle = texture._frame;
        rectangle.x = sx;
        rectangle.y = sy;
        rectangle.width = sw;
        rectangle.height = sh;
        texture._updateUvs();

        this.sprite.texture = texture;
    };

    PixiSprite.prototype.toString = function () {
        return '[object PixiSprite]';
    };

    return PixiSprite;
});
/**
 * Component that draws a Spine animation. A Spine asset must consist of a json, atlas and png with the same name. Developer must add
 [spine-canvas.js]{@link https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/3.6/spine-ts/build/spine-canvas.js} manually.
 * Note: made with canvas2d renderer in mind.
 * Note about skins: Lazy loading can be turned on with Bento.assets.lazyLoadSpine = true before the assets are loaded. This is useful if the spine
 * animations contains many skins and you want to prevent all of the skins to be preloaded. The asset manager will no longer manage the spine images.
 * Instead can call Spine.cleanLazyLoadedImages() to remove all images.
 * <br>Exports: Constructor
 * @module bento/components/spine
 * @moduleName Spine
* @snippet Spine.snippet
Spine({
    spine: '${1}',
    animation: '${2:idle}',
    scale: ${3:1},
    triangleRendering: false
})
 * @param {Object} settings - Settings
 * @param {String} settings.spine - Name of the spine asset
 * @param {String} settings.animation - Initial animation to play, defaults to 'default'
 * @param {Function} settings.onEvent - Animation state callback
 * @param {Function} settings.onComplete - Animation state callback
 * @param {Function} settings.onStart - Animation state callback
 * @param {Function} settings.onEnd - Animation state callback
 * @returns Returns a component object to be attached to an entity.
 */
bento.define('bento/components/spine', [
    'bento/utils',
    'bento',
    'bento/math/vector2'
], function (
    Utils,
    Bento,
    Vector2
) {
    'use strict';
    /**
     * Fake texture in case of lazy loading
     */
    var fakeTexture;
    var getFakeTexture = function () {
        var image;
        if (!fakeTexture) {
            image = new Image();
            fakeTexture = new window.spine.FakeTexture(image);
        }
        return fakeTexture;
    };
    var lazyLoadedImages = {};
    /**
     * Get/load the asset for the spine sprite
     */
    var loadSkeletonData = function (name, initialAnimation, listeners, skin) {
        var skeletonDataOut;
        var spineData = Bento.assets.getSpine(name);
        var skinsPerImage = spineData.skinImages;
        var spineAssetLoader = Bento.assets.getSpineLoader();
        // returns the textures for an atlas
        var textureLoader = function (path) {
            var output = spineAssetLoader.get(spineData.path + path);
            if (!output) {
                // image may not be loaded (lazyloading spine), return a fake texture for now
                output = getFakeTexture();

                // do we need the image for this skin?
                // Spine will otherwise attempt to load every image related to a TextureAtlas,
                // we made the link between skins and images during the asset loading (see managers/asset.js)
                if (skin === skinsPerImage[path]) {
                    // load correct image asap
                    lazyLoad(path);
                }
            }
            return output;
        };
        var lazyLoad = function (path) {
            // load the real texture now
            spineAssetLoader.loadTexture(
                spineData.path + path,
                function (p, img) {
                    // reload everything
                    var newData = loadSkeletonData(name, initialAnimation, listeners, skin);
                    // pass back to original data
                    skeletonDataOut.skeleton = newData.skeleton;
                    skeletonDataOut.state = newData.state;
                    skeletonDataOut.bounds = bounds.skeleton;
                    // alert the spine component that skeleton data is updated
                    if (skeletonDataOut.onReload) {
                        skeletonDataOut.onReload();
                    }

                    // save path
                    lazyLoadedImages[p] = img;
                },
                function () {
                    // error
                }
            );
        };
        // Load the texture atlas using name.atlas and name.png from the AssetManager.
        // The function passed to TextureAtlas is used to resolve relative paths.
        var atlas = new window.spine.TextureAtlas(spineData.atlas, textureLoader);

        // Create a AtlasAttachmentLoader, which is specific to the WebGL backend.
        var atlasLoader = new window.spine.AtlasAttachmentLoader(atlas);

        // Create a SkeletonJson instance for parsing the .json file.
        var skeletonJson = new window.spine.SkeletonJson(atlasLoader);

        // Set the scale to apply during parsing, parse the file, and create a new skeleton.
        var skeletonData = skeletonJson.readSkeletonData(spineData.skeleton);
        var skeleton = new window.spine.Skeleton(skeletonData);
        skeleton.flipY = true;
        var bounds = calculateBounds(skeleton);
        skeleton.setSkinByName(skin);

        // Create an AnimationState, and set the initial animation in looping mode.
        var animationState = new window.spine.AnimationState(new window.spine.AnimationStateData(skeleton.data));
        animationState.setAnimation(0, initialAnimation, true);
        animationState.addListener({
            event: listeners.onEvent || function (trackIndex, event) {
                // console.log("Event on track " + trackIndex + ": " + JSON.stringify(event));
            },
            complete: listeners.onComplete || function (trackIndex, loopCount) {
                // console.log("Animation on track " + trackIndex + " completed, loop count: " + loopCount);
            },
            start: listeners.onStart || function (trackIndex) {
                // console.log("Animation on track " + trackIndex + " started");
            },
            end: listeners.onEnd || function (trackIndex) {
                // console.log("Animation on track " + trackIndex + " ended");
            }
        });

        // Pack everything up and return to caller.
        skeletonDataOut = {
            skeleton: skeleton,
            state: animationState,
            bounds: bounds,
            onReload: null
        };
        return skeletonDataOut;
    };
    var calculateBounds = function (skeleton) {
        var data = skeleton.data;
        skeleton.setToSetupPose();
        skeleton.updateWorldTransform();
        var offset = new window.spine.Vector2();
        var size = new window.spine.Vector2();
        skeleton.getBounds(offset, size, []);
        return {
            offset: offset,
            size: size
        };
    };
    var skeletonRenderer;
    var debugRendering = false;

    var Spine = function (settings) {
        var name = settings.name || 'spine';
        var spineName = settings.spineName || settings.spine;
        var skin = settings.skin || 'default';
        var currentAnimation = settings.animation || 'default';
        var isLooping = true;
        // animation state listeners
        var onEvent = settings.onEvent;
        var onComplete = settings.onComplete;
        var onStart = settings.onStart;
        var onEnd = settings.onEnd;
        // enable the triangle renderer, supports meshes, but may produce artifacts in some browsers
        var useTriangleRendering = settings.triangleRendering || false;
        var skeletonData;
        var skeleton, state, bounds;
        var currentAnimationSpeed = 1;
        var entity;
        // todo: investigate internal scaling
        var scale = settings.scale || 1;
        var component = {
            name: name,
            start: function (data) {
                // load the skeleton data if that's not been done yet
                if (!skeletonData) {
                    skeletonData = loadSkeletonData(spineName, currentAnimation, {
                        onEvent: onEvent,
                        onComplete: function (trackIndex, loopCount) {
                            if (onComplete) {
                                onComplete(trackIndex, loopCount);
                            }
                        },
                        onStart: onStart,
                        onEnd: onEnd
                    }, skin);
                    skeleton = skeletonData.skeleton;
                    state = skeletonData.state;
                    bounds = skeletonData.bounds;

                    // anticipate lazy load
                    skeletonData.onReload = function () {
                        // rebind data
                        skeleton = skeletonData.skeleton;
                        state = skeletonData.state;
                        bounds = skeletonData.bounds;
                        // apply previous state
                        state.setAnimation(0, currentAnimation, isLooping);
                        state.apply(skeleton);
                    };
                }
                // initialize skeleton renderer
                if (!skeletonRenderer) {
                    skeletonRenderer = new window.spine.canvas.SkeletonRenderer(data.renderer.getContext());
                    skeletonRenderer.debugRendering = debugRendering;
                }
                updateEntity();

                if (!Utils.isNumber(scale)) {
                    Utils.log('ERROR: scale must be a number');
                    scale = 1;
                }
            },
            destroy: function (data) {},
            update: function (data) {
                state.update(data.deltaT / 1000 * data.speed * currentAnimationSpeed);
                state.apply(skeleton);
            },
            draw: function (data) {
                // todo: investigate scaling
                data.renderer.scale(scale, scale);
                skeleton.updateWorldTransform();
                skeletonRenderer.triangleRendering = useTriangleRendering;
                skeletonRenderer.draw(skeleton);
                data.renderer.scale(1 / scale, 1 / scale);
            },
            attached: function (data) {
                entity = data.entity;
            },
            /**
             * Set animation
             * @function
             * @instance
             * @param {String} name - Name of animation
             * @param {Function} [callback] - Callback on complete, will overwrite onEnd if set
             * @param {Boolean} [loop] - Loop animation
             * @name setAnimation
             * @snippet #Spine.setAnimation|snippet
                setAnimation('$1');
             * @snippet #Spine.setAnimation|callback
                setAnimation('$1', function () {
                    $2
                });
             */
            setAnimation: function (name, callback, loop) {
                if (currentAnimation === name) {
                    // already playing
                    return;
                }
                // update current animation
                currentAnimation = name;
                // reset speed
                currentAnimationSpeed = 1;
                isLooping = Utils.getDefault(loop, true);
                // apply animation
                state.setAnimation(0, name, isLooping);
                // set callback, even if undefined
                onComplete = callback;
                // apply the skeleton to avoid visual delay
                state.apply(skeleton);
            },
            /**
             * Get current animation name
             * @function
             * @instance
             * @name getAnimation
             * @snippet #Spine.getAnimation|String
                getAnimation();
             * @returns {String} Returns name of current animation.
             */
            getAnimationName: function () {
                return currentAnimation;
            },
            /**
             * Get speed of the current animation, relative to Spine's speed
             * @function
             * @instance
             * @returns {Number} Speed of the current animation
             * @name getCurrentSpeed
             * @snippet #Spine.getCurrentSpeed|Number
                getCurrentSpeed();
             */
            getCurrentSpeed: function () {
                return currentAnimationSpeed;
            },
            /**
             * Set speed of the current animation.
             * @function
             * @instance
             * @param {Number} speed - Speed at which the animation plays.
             * @name setCurrentSpeed
             * @snippet #Spine.setCurrentSpeed|snippet
                setCurrentSpeed(${1:number});
             */
            setCurrentSpeed: function (value) {
                currentAnimationSpeed = value;
            },
            /**
             * Exposes Spine skeleton data and animation state variables for manual manipulation
             * @function
             * @instance
             * @name getSpineData
             * @snippet #Spine.getSpineData|snippet
                getSpineData();
             */
            getSpineData: function () {
                return {
                    skeletonData: skeleton,
                    animationState: state
                };
            }
        };
        var updateEntity = function () {
            if (!entity) {
                return;
            }

            entity.dimension.x = bounds.offset.x * scale;
            entity.dimension.y = bounds.offset.y * scale;
            entity.dimension.width = bounds.size.x * scale;
            entity.dimension.height = bounds.size.y * scale;
        };
        return component;
    };

    Spine.setDebugRendering = function (bool) {
        if (skeletonRenderer) {
            skeletonRenderer.debugRendering = bool;
        }
    };

    Spine.cleanLazyLoadedImages = function () {
        // clearing up memory
        // don't call this during update loops! 
        // no spine components should be alive when this is called, because all references will be invalid
        var spineAssetLoader = Bento.assets.getSpineLoader();
        Utils.forEach(lazyLoadedImages, function (image, imagePath, l, breakLoop) {
            try {
                spineAssetLoader.remove(imagePath);
            } catch (e) {
                Utils.log(e);
            }

            if (image.dispose) {
                // alternatively we could not call dispose and let the garbage collector do its work
                image.dispose();
            }
        });
        lazyLoadedImages = [];
    };

    return Spine;
});
/**
 * Sprite component. Draws an animated sprite on screen at the entity's transform.
 * <br>Exports: Constructor
 * @module bento/components/sprite
 * @moduleName Sprite
 * @snippet Sprite|spriteSheet
Sprite({
    spriteSheet: '${1}'
})
 * @snippet Sprite|imageName
Sprite({
    imageName: '${1}',
    originRelative: new Vector2(${2:0.5}, ${3:0.5}),
    frameCountX: ${4:1},
    frameCountY: ${5:1},
    animations: {
        default: {
            speed: 0,
            frames: [0]
        }
    }
})
 * @param {Object} settings - Settings
 * @param {String} settings.name - Overwites the component name (default is "sprite")
 * @param {String} settings.spriteSheet - (Using spritesheet assets) Asset name for the spriteSheet asset. If one uses spritesheet assets, this is the only parameter that is needed.
 * @param {String} settings.imageName - (Using image assets) Asset name for the image.
 * @param {Number} settings.frameCountX - Number of animation frames horizontally (defaults to 1)
 * @param {Number} settings.frameCountY - Number of animation frames vertically (defaults to 1)
 * @param {Number} settings.frameWidth - Alternative for frameCountX, sets the width manually
 * @param {Number} settings.frameHeight - Alternative for frameCountY, sets the height manually
 * @param {Number} settings.paddding - Pixelsize between frames
 * @param {Vector2} settings.origin - Vector2 of origin
 * @param {Vector2} settings.originRelative - Vector2 of relative origin (relative to dimension size)
 * @param {Object} settings.animations - Only needed if an image asset) Object literal defining animations, the object literal keys are the animation names.
 * @param {Boolean} settings.animations[...].loop - Whether the animation should loop (defaults to true)
 * @param {Number} settings.animations[...].backTo - Loop back the animation to a certain frame (defaults to 0)
 * @param {Number} settings.animations[...].speed - Speed at which the animation is played. 1 is max speed (changes frame every tick). (defaults to 1)
 * @param {Array} settings.animations[...].frames - The frames that define the animation. The frames are counted starting from 0 (the top left)
 * @example
// Defines a 3 x 3 spritesheet with several animations
// Note: The default is automatically defined if no animations object is passed
var sprite = new Sprite({
        imageName: "mySpriteSheet",
        frameCountX: 3,
        frameCountY: 3,
        animations: {
            "default": {
                frames: [0]
            },
            "walk": {
                speed: 0.2,
                frames: [1, 2, 3, 4, 5, 6]
            },
            "jump": {
                speed: 0.2,
                frames: [7, 8]
            }
        }
     }),
    entity = new Entity({
        components: [sprite] // attach sprite to entity
                             // alternative to passing a components array is by calling entity.attach(sprite);
    });

// attach entity to game
Bento.objects.attach(entity);
 * @returns Returns a component object to be attached to an entity.
 */
bento.define('bento/components/sprite', [
    'bento',
    'bento/utils',
    'bento/math/vector2'
], function (
    Bento,
    Utils,
    Vector2
) {
    'use strict';
    var Sprite = function (settings) {
        if (!(this instanceof Sprite)) {
            return new Sprite(settings);
        }
        this.entity = null;
        this.name = settings.name || 'sprite';
        this.visible = true;
        this.parent = null;
        this.rootIndex = -1;

        this.animationSettings = settings || {
            frameCountX: 1,
            frameCountY: 1
        };

        // sprite settings
        this.spriteImage = null;
        this.frameCountX = 1;
        this.frameCountY = 1;
        this.frameWidth = 0;
        this.frameHeight = 0;
        this.padding = 0;
        this.origin = new Vector2(0, 0);

        // keep a reference to the spritesheet name
        this.currentSpriteSheet = '';

        // drawing internals
        this.sourceX = 0;
        this.sourceY = 0;

        // set to default
        this.animations = {};
        this.currentAnimation = null;
        this.currentAnimationLength = 0;
        this.currentFrame = 0;

        this.sprite = new window.PIXI.Sprite();
        this.scaleMode = settings.scaleMode || (Bento.getAntiAlias() ? window.PIXI.SCALE_MODES.LINEAR : window.PIXI.SCALE_MODES.NEAREST);


        this.onCompleteCallback = function () {};
        this.setup(settings);
    };
    /**
     * Sets up Sprite. This can be used to overwrite the settings object passed to the constructor.
     * @function
     * @instance
     * @param {Object} settings - Settings object
     * @name setup
     * @snippet #Sprite.setup|spriteSheet
setup({
    spriteSheet: '${1}'
});
     * @snippet #Sprite.setup|imageName
setup({
    imageName: '${1}',
    originRelative: new Vector2(${2:0.5}, ${3:0.5}),
    frameCountX: ${4:1},
    frameCountY: ${5:1},
    animations: {
        default: {
            speed: 0,
            frames: [0]
        }
    }
});
     */
    Sprite.prototype.setup = function (settings) {
        var self = this,
            padding = 0,
            spriteSheet;

        if (settings && settings.spriteSheet) {
            //load settings from animation JSON, and set the correct image
            spriteSheet = Bento.assets.getSpriteSheet(settings.spriteSheet);

            // remember the spritesheet name
            this.currentSpriteSheet = settings.spriteSheet;

            // settings is overwritten
            settings = Utils.copyObject(spriteSheet.animation);
            settings.image = spriteSheet.image;
            if (settings.animation) {
                settings.animations = {
                    default: settings.animation
                };
            }
        }

        this.animationSettings = settings || this.animationSettings;
        padding = this.animationSettings.padding || 0;

        // add default animation
        if (!this.animations['default']) {
            if (!this.animationSettings.animations) {
                this.animationSettings.animations = {};
            }
            if (!this.animationSettings.animations['default']) {
                this.animationSettings.animations['default'] = {
                    frames: [0]
                };
            }
        }

        // get image
        if (settings.image) {
            this.spriteImage = settings.image;
        } else if (settings.imageName) {
            // load from string
            if (Bento.assets) {
                this.spriteImage = Bento.assets.getImage(settings.imageName);
            } else {
                throw 'Bento asset manager not loaded';
            }
        } else if (settings.imageFromUrl) {
            // load from url
            if (!this.spriteImage && Bento.assets) {
                Bento.assets.loadImageFromUrl(settings.imageFromUrl, settings.imageFromUrl, function (err, asset) {
                    self.spriteImage = Bento.assets.getImage(settings.imageFromUrl);
                    self.setup(settings);

                    if (settings.onLoad) {
                        settings.onLoad();
                    }
                });
                // wait until asset is loaded and then retry
                return;
            }
        } else {
            // no image specified
            return;
        }
        if (!this.spriteImage) {
            Utils.log("ERROR: something went wrong with loading the sprite.");
            return;
        }
        // use frameWidth if specified (overrides frameCountX and frameCountY)
        if (this.animationSettings.frameWidth) {
            this.frameWidth = this.animationSettings.frameWidth;
            this.frameCountX = Math.floor(this.spriteImage.width / this.frameWidth);
        } else {
            this.frameCountX = this.animationSettings.frameCountX || 1;
            this.frameWidth = (this.spriteImage.width - padding * (this.frameCountX - 1)) / this.frameCountX;
        }
        if (this.animationSettings.frameHeight) {
            this.frameHeight = this.animationSettings.frameHeight;
            this.frameCountY = Math.floor(this.spriteImage.height / this.frameHeight);
        } else {
            this.frameCountY = this.animationSettings.frameCountY || 1;
            this.frameHeight = (this.spriteImage.height - padding * (this.frameCountY - 1)) / this.frameCountY;
        }

        this.padding = this.animationSettings.padding || 0;

        if (this.animationSettings.origin) {
            this.origin.x = this.animationSettings.origin.x;
            this.origin.y = this.animationSettings.origin.y;
        } else if (this.animationSettings.originRelative) {
            this.setOriginRelative(this.animationSettings.originRelative);
        }

        // set default
        Utils.extend(this.animations, this.animationSettings.animations, true);
        this.setAnimation('default');

        this.updateEntity();
    };

    Sprite.prototype.updateEntity = function () {
        if (!this.entity) {
            return;
        }

        this.entity.dimension.x = -this.origin.x;
        this.entity.dimension.y = -this.origin.y;
        this.entity.dimension.width = this.frameWidth;
        this.entity.dimension.height = this.frameHeight;
    };

    Sprite.prototype.attached = function (data) {
        var animation,
            animations = this.animationSettings.animations,
            i = 0,
            len = 0,
            highestFrame = 0;

        this.entity = data.entity;
        // set dimension of entity object
        this.updateEntity();

        // check if the frames of animation go out of bounds
        for (animation in animations) {
            for (i = 0, len = animations[animation].frames.length; i < len; ++i) {
                if (animations[animation].frames[i] > highestFrame) {
                    highestFrame = animations[animation].frames[i];
                }
            }
            if (!Sprite.suppressWarnings && highestFrame > this.frameCountX * this.frameCountY - 1) {
                console.log("Warning: the frames in animation " + animation + " of " + (this.entity.name || this.entity.settings.name) + " are out of bounds. Can't use frame " + highestFrame + ".");
            }

        }
    };
    /**
     * Set component to a different animation. The animation won't change if it's already playing.
     * @function
     * @instance
     * @param {String} name - Name of the animation.
     * @param {Function} callback - Called when animation ends.
     * @param {Boolean} keepCurrentFrame - Prevents animation to jump back to frame 0
     * @name setAnimation
     * @snippet #Sprite.setAnimation|snippet
setAnimation('${1:name}');
     * @snippet #Sprite.setAnimation|callback
setAnimation('${1:name}', function () {
    $2
});
     */
    Sprite.prototype.setAnimation = function (name, callback, keepCurrentFrame) {
        var anim = this.animations[name];
        if (!Sprite.suppressWarnings && !anim) {
            console.log('Warning: animation ' + name + ' does not exist.');
            return;
        }
        if (anim && (this.currentAnimation !== anim || (this.onCompleteCallback !== null && Utils.isDefined(callback)))) {
            if (!Utils.isDefined(anim.loop)) {
                anim.loop = true;
            }
            if (!Utils.isDefined(anim.backTo)) {
                anim.backTo = 0;
            }
            // set even if there is no callback
            this.onCompleteCallback = callback;
            this.currentAnimation = anim;
            this.currentAnimation.name = name;
            this.currentAnimationLength = this.currentAnimation.frames.length;
            if (!keepCurrentFrame) {
                this.currentFrame = 0;
            }
            if (!Sprite.suppressWarnings && this.currentAnimation.backTo > this.currentAnimationLength) {
                console.log('Warning: animation ' + name + ' has a faulty backTo parameter');
                this.currentAnimation.backTo = this.currentAnimationLength;
            }
        }
    };
    /**
     * Bind another spritesheet to this sprite. The spritesheet won't change if it's already playing
     * @function
     * @instance
     * @param {String} name - Name of the spritesheet.
     * @param {Function} callback - Called when animation ends.
     * @name setAnimation
     * @snippet #Sprite.setSpriteSheet|snippet
setSpriteSheet('${1:name}');
     * @snippet #Sprite.setSpriteSheet|callback
setSpriteSheet('${1:name}', function () {
    $2
});
     */
    Sprite.prototype.setSpriteSheet = function (name, callback) {
        if (this.currentSpriteSheet === name) {
            // already playing
            return;
        }
        this.setup({
            spriteSheet: name
        });

        this.onCompleteCallback = callback;
    };
    /**
     * Returns the name of current animation playing
     * @function
     * @instance
     * @returns {String} Name of the animation playing, null if not playing anything
     * @name getAnimationName
     * @snippet #Sprite.getAnimationName|String
getAnimationName();
     */
    Sprite.prototype.getAnimationName = function () {
        return this.currentAnimation.name;
    };
    /**
     * Set current animation to a certain frame
     * @function
     * @instance
     * @param {Number} frameNumber - Frame number.
     * @name setFrame
     * @snippet #Sprite.getAnimationName|snippet
setFrame(${1:number});
     */
    Sprite.prototype.setFrame = function (frameNumber) {
        this.currentFrame = frameNumber;
    };
    /**
     * Get speed of the current animation.
     * @function
     * @instance
     * @returns {Number} Speed of the current animation
     * @name getCurrentSpeed
     * @snippet #Sprite.getCurrentSpeed|Number
getCurrentSpeed();
     */
    Sprite.prototype.getCurrentSpeed = function () {
        return this.currentAnimation.speed;
    };
    /**
     * Set speed of the current animation.
     * @function
     * @instance
     * @param {Number} speed - Speed at which the animation plays.
     * @name setCurrentSpeed
     * @snippet #Sprite.setCurrentSpeed|snippet
setCurrentSpeed(${1:number});
     */
    Sprite.prototype.setCurrentSpeed = function (value) {
        this.currentAnimation.speed = value;
    };
    /**
     * Returns the current frame number
     * @function
     * @instance
     * @returns {Number} frameNumber - Not necessarily a round number.
     * @name getCurrentFrame
     * @snippet #Sprite.getCurrentFrame|Number
getCurrentFrame();
     */
    Sprite.prototype.getCurrentFrame = function () {
        return this.currentFrame;
    };
    /**
     * Returns the frame width
     * @function
     * @instance
     * @returns {Number} width - Width of the image frame.
     * @name getFrameWidth
     * @snippet #Sprite.getFrameWidth|Number
getFrameWidth();
     */
    Sprite.prototype.getFrameWidth = function () {
        return this.frameWidth;
    };
    /**
     * Returns the frame height
     * @function
     * @instance
     * @returns {Number} height - Height of the image frame.
     * @name getFrameHeight
     * @snippet #Sprite.getFrameHeight|Number
getFrameHeight();
     */
    Sprite.prototype.getFrameHeight = function () {
        return this.frameHeight;
    };
    /**
     * Sets the origin relatively (0...1), relative to the size of the frame.
     * @function
     * @param {Vector2} origin - Position of the origin (relative to upper left corner)
     * @instance
     * @name setOriginRelative
     * @snippet #Sprite.setOriginRelative|snippet
setOriginRelative(new Vector2(${1:0}, ${2:0}));
     */
    Sprite.prototype.setOriginRelative = function (originRelative) {
        this.origin.x = originRelative.x * this.frameWidth;
        this.origin.y = originRelative.y * this.frameHeight;
    };
    Sprite.prototype.update = function (data) {
        var reachedEnd;
        if (!this.currentAnimation) {
            return;
        }

        // no need for update
        if (this.currentAnimationLength <= 1 || this.currentAnimation.speed === 0) {
            return;
        }

        var frameSpeed = this.currentAnimation.speed || 1;
        if (this.currentAnimation.frameSpeeds && this.currentAnimation.frameSpeeds.length >= this.currentFrame) {
            frameSpeed *= this.currentAnimation.frameSpeeds[Math.floor(this.currentFrame)];
        }

        reachedEnd = false;
        this.currentFrame += (frameSpeed) * data.speed;
        if (this.currentAnimation.loop) {
            while (this.currentFrame >= this.currentAnimation.frames.length) {
                this.currentFrame -= this.currentAnimation.frames.length - this.currentAnimation.backTo;
                reachedEnd = true;
            }
        } else {
            if (this.currentFrame >= this.currentAnimation.frames.length) {
                reachedEnd = true;
            }
        }
        if (reachedEnd && this.onCompleteCallback) {
            this.onCompleteCallback();
            //don't repeat callback on non-looping animations
            if (!this.currentAnimation.loop) {
                this.onCompleteCallback = null;
            }
        }
    };

    Sprite.prototype.updateFrame = function () {
        var frameIndex = Math.min(Math.floor(this.currentFrame), this.currentAnimation.frames.length - 1);
        var sourceFrame = this.currentAnimation.frames[frameIndex];
        this.sourceX = (sourceFrame % this.frameCountX) * (this.frameWidth + this.padding);
        this.sourceY = Math.floor(sourceFrame / this.frameCountX) * (this.frameHeight + this.padding);
    };

    Sprite.prototype.draw = function (data) {
       var entity = data.entity;

        if (!this.currentAnimation || !this.visible) {
            return;
        }
        this.updateFrame();
        this.updateSprite(
            this.spriteImage,
            this.sourceX,
            this.sourceY,
            this.frameWidth,
            this.frameHeight
        );

        // draw with pixi
        data.renderer.translate(-Math.round(this.origin.x), -Math.round(this.origin.y));
        data.renderer.drawPixi(this.sprite);
        data.renderer.translate(Math.round(this.origin.x), Math.round(this.origin.y));
    };
    Sprite.prototype.updateSprite = function (packedImage, sx, sy, sw, sh) {
        var rectangle;
        var sprite;
        var texture;
        var image;

        if (!packedImage) {
            return;
        }
        image = packedImage.image;
        if (!image.texture) {
            // initialize pixi baseTexture
            image.texture = new window.PIXI.BaseTexture(image, this.scaleMode);
            image.frame = new window.PIXI.Texture(image.texture);
        }
        texture = image.frame;
        rectangle = texture._frame;
        rectangle.x = sx;
        rectangle.y = sy;
        rectangle.width = sw;
        rectangle.height = sh;
        texture.updateUvs();

        this.sprite.texture = texture;
    };
    Sprite.prototype.toString = function () {
        return '[object Sprite]';
    };

    /**
     * Ignore warnings about invalid animation frames
     * @instance
     * @static
     * @name suppressWarnings
     */
    Sprite.suppressWarnings = false;

    return Sprite;
});
/**
 * A base object to hold components. Has dimension, position, scale and rotation properties (though these don't have much
 meaning until you attach a Sprite component). Entities can be added to the game by calling Bento.objects.attach().
 Entities can be visualized by using the Sprite component, or you can attach your own component and add a draw function.
 * <br>Exports: Constructor
 * @module {Entity} bento/entity
 * @moduleName Entity
 * @param {Object} settings - settings (all properties are optional)
 * @param {Function} settings.init - Called when entity is initialized
 * @param {Array} settings.components - Array of component module functions
 * @param {Array} settings.family - Array of family names. See {@link module:bento/managers/object#getByFamily}
 * @param {Vector2} settings.position - Vector2 of position to set
 * @param {Rectangle} settings.dimension - Size of the entity
 * @param {Rectangle} settings.boundingBox - Rectangle used for collision checking (if this does not exist, dimension is used as bounding box)
 * @param {Number} settings.z - z-index to set (note: higher values go on top)
 * @param {Number} settings.alpha - Opacity of the entity (1 = fully visible)
 * @param {Number} settings.rotation - Rotation of the entity in radians
 * @param {Vector2} settings.scale - Scale of the entity
 * @param {Boolean} settings.updateWhenPaused - Should entity keep updating when game is paused
 * @param {Boolean} settings.global - Should entity remain after hiding a screen
 * @param {Boolean} settings.float - Should entity move with the screen
 * @example
var entity = new Entity({
    z: 0,
    name: 'myEntity',
    position: new Vector2(32, 32),
    components: [new Sprite({
        imageName: 'myImage',
        originRelative: new Vector2(0.5, 1)    // bottom center origin
    })] // see Sprite module
 });
 * // attach entity to Bento Objects
 * Bento.objects.attach(entity);
 * @returns {Entity} Returns a new entity object
 * @snippet Entity|constructor
Entity({
    z: ${1:0},
    name: '$2',
    family: [''],
    position: new Vector2(${3:0}, ${4:0}),
    components: [
        $5
    ]
});
 */
bento.define('bento/entity', [
    'bento',
    'bento/utils',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/math/transformmatrix',
    'bento/transform'
], function (
    Bento,
    Utils,
    Vector2,
    Rectangle,
    Matrix,
    Transform
) {
    'use strict';
    var cleanComponents = function (entity) {
        // remove null components
        var i;
        for (i = entity.components.length - 1; i >= 0; --i) {
            if (!entity.components[i]) {
                entity.components.splice(i, 1);
            }
        }
    };
    var id = 0;

    var Entity = function (settings) {
        if (!(this instanceof Entity)) {
            return new Entity(settings);
        }
        var i, l;
        /**
         * Name of the entity
         * @instance
         * @default ''
         * @name name
         * @snippet #Entity.name|String
            name
         * @snippet #Entity.isAdded|read-only
            isAdded
         */
        this.name = '';
        /**
         * Position of the entity
         * @instance
         * @default Vector2(0, 0)
         * @name position
         * @snippet #Entity.position|Vector2
            position
         */
        this.position = new Vector2(0, 0);
        /*
         * UNLISTED developer should never edit this array directly
         * Families of the entity. Note: edit this before the entity is attached.
         * @instance
         * @default []
         * @see module:bento/managers/object#getByFamily
         * @name family
         */
        this.family = [];
        /*
         * UNLISTED developer should never edit this array directly
         * Components of the entity
         * @instance
         * @default []
         * @name components
         * @snippet #Entity.components|Array
            components
         */
        this.components = [];

        this.global = false;
        /**
         * Indicates if an object should move with the scrolling of the screen
         * @instance
         * @default false
         * @name float
         * @snippet #Entity.float|Boolean
            float
         */
        this.float = false;
        /**
         * Indicates if an object should continue updating when the game is paused.
         * If updateWhenPaused is larger or equal than the pause level then the
         * game ignores the pause.
         * @instance
         * @default 0
         * @name updateWhenPaused
         * @snippet #Entity.updateWhenPaused|Number
            updateWhenPaused
         */
        this.updateWhenPaused = 0;
        this.isAdded = false;
        /**
         * Dimension of the entity
         * @instance
         * @default Rectangle(0, 0, 0, 0)
         * @name dimension
         * @snippet #Entity.dimension|Rectangle
            dimension
         */
        this.dimension = new Rectangle(0, 0, 0, 0);
        /**
         * Boundingbox of the entity
         * @instance
         * @default null
         * @see module:bento/entity#getBoundingBox for usage
         * @name boundingBox
         * @snippet #Entity.boundingBox|Rectangle
            boundingBox
         */
        this.boundingBox = settings.boundingBox || null;
        /**
         * Scale of the entity
         * @instance
         * @default Vector2(1, 1)
         * @name scale
         * @snippet #Entity.scale|Vector2
            scale
         */
        this.scale = new Vector2(1, 1);
        /**
         * Rotation of the entity in radians
         * @instance
         * @default 0
         * @name rotation
         * @snippet #Entity.rotation|Number
            rotation
         */
        this.rotation = 0;
        /**
         * Opacity of the entity
         * @instance
         * @default 1
         * @name alpha
         * @snippet #Entity.alpha|Number
            alpha
         */
        this.alpha = 1;
        /**
         * Whether the entity calls the draw function
         * @instance
         * @default true
         * @name visible
         * @snippet #Entity.visible|Boolean
            visible
         */
        this.visible = true;
        /**
         * Unique id
         * @instance
         * @name id
         * @snippet #Entity.id|Number
            id
         */
        this.id = id++;
        /**
         * z-index of an object
         * @instance
         * @default 0
         * @name z
         * @snippet #Entity.z|Number
            z
         */
        this.z = 0;
        /**
         * Index position of its parent (if any)
         * @instance
         * @default -1
         * @name rootIndex
         */
        this.rootIndex = -1;
        /**
         * Timer value, incremented every update step (dependent on game speed)
         * @instance
         * @default 0
         * @name timer
         * @snippet #Entity.timer|Number
            timer
         */
        this.timer = 0;
        /**
         * Ticker value, incremented every update step (independent of game speed)
         * @instance
         * @default 0
         * @name ticker
         * @snippet #Entity.ticker|Number
            ticker
         */
        this.ticker = 0;
        /**
         * Indicates if an object should not be destroyed when a Screen ends
         * @instance
         * @default false
         * @name global
         * @snippet #Entity.global|Boolean
            global
         */
        /**
         * Transform module
         * @instance
         * @name transform
         * @snippet #Entity.transform|Transform
            transform
         */
        this.transform = new Transform(this);
        /**
         * Entity's parent object, is set by the attach function, not recommended to set manually unless you know what you're doing.
         * @instance
         * @default null
         * @see module:bento/entity#attach
         * @name parent
         * @snippet #Entity.parent|read-only
            parent
         */
        this.parent = null;
        /**
         * Reference to the settings parameter passed to the constructor
         * @instance
         * @name settings
         * @snippet #Entity.settings|Object
            settings
         */
        this.settings = settings;
        // Current component that is being processed, useful for debugging
        this.currentComponent = null;

        // read settings
        if (settings) {
            if (settings.position) {
                this.position = settings.position; // should this be cloned?
            }
            if (settings.dimension) {
                this.dimension = settings.dimension;
            }
            if (settings.scale) {
                this.scale = settings.scale;
            }
            if (settings.name) {
                this.name = settings.name;
            }
            if (settings.family) {
                if (!Utils.isArray(settings.family)) {
                    settings.family = [settings.family];
                }
                for (i = 0, l = settings.family.length; i < l; ++i) {
                    this.family.push(settings.family[i]);
                }
            }
            if (Utils.isDefined(settings.alpha)) {
                this.alpha = settings.alpha;
            }
            if (Utils.isDefined(settings.rotation)) {
                this.rotation = settings.rotation;
            }
            if (Utils.isDefined(settings.visible)) {
                this.visible = settings.visible;
            }

            this.z = settings.z || 0;
            this.updateWhenPaused = settings.updateWhenPaused || 0;
            this.global = settings.global || false;
            this.float = settings.float || false;

            // attach components after initializing other variables
            if (settings.components) {
                if (!Utils.isArray(settings.components)) {
                    settings.components = [settings.components];
                }
                for (i = 0, l = settings.components.length; i < l; ++i) {
                    this.attach(settings.components[i]);
                }
            }
            // you might want to do things before the entity returns
            if (settings.init) {
                settings.init.apply(this);
            }

            if (settings.addNow) {
                Bento.objects.add(this);
            }
        }
    };
    Entity.prototype.isEntity = function () {
        return true;
    };

    /**
     * Extends properties of entity
     * @function
     * @instance
     * @param {Object} object - other object
     * @see module:bento/utils#extend
     * @example
var entity = new Entity({});

entity.extend({
    addX: function (x) {
        entity.position.x += x;
        // alternatively, this.position.x would work too.
    }
});

entity.addX(10);
    * @snippet #Entity.extend|Entity
extend(${1:{}});
     * @returns {Entity} Returns itself
     * @name extend
     */
    Entity.prototype.extend = function (object) {
        return Utils.extend(this, object);
    };
    /**
     * Returns the bounding box of an entity that's ready to be compared for collisions.
     * If no bounding box was set to entity.boundingBox, the dimension assumed as bounding box size.
     * entity.boundingBox is a Rectangle relative the entity's position, while getBoundingBox returns
     * a rectangle that's positioned in world space and scaled appropiately (AABB only, does not take into account rotation)
     * @function
     * @returns {Rectangle} boundingbox - Entity's boundingbox with translation and scaling
     * @instance
     * @name getBoundingBox
    * @snippet #Entity.getBoundingBox|Rectangle
getBoundingBox();
     * @returns {Rectangle} A rectangle representing the boundingbox of the entity
     */
    var correctBoundingBox = function (entity, boundingBox) {
        // this function offsets a boundingbox with an entity's position and scale
        var box = boundingBox.clone();
        var position = entity.position;
        var scale = entity.scale;
        // note that we need the abs of scale to prevent negative widths
        box.x *= Math.abs(scale.x);
        box.y *= Math.abs(scale.y);
        box.width *= Math.abs(scale.x);
        box.height *= Math.abs(scale.y);
        if (scale.x < 0) {
            box.x = -box.x - box.width;
        }
        if (scale.y < 0) {
            box.y = -box.y - box.height;
        }
        box.x += position.x;
        box.y += position.y;
        return box;
    };
    Entity.prototype.getBoundingBox = function () {
        return correctBoundingBox(this, this.boundingBox || this.dimension);
    };

    /**
     * Attaches a child object to the entity. Entities can form a scenegraph this way.
     * This is one of the most important functions in Bento. It allows you to attach new behaviors
     * to the entity by attaching components or other Entities.
     * The parent entity calls start(), destroy(), update() and draw() in the child.
     * The child will have a 'parent' property, which references the parent entity.
     * @function
     * @param {Object} child - The child object to attach (can be anything)
     * @param {Boolean} force - Allow duplicate attaching
     * @instance
     * @example
var entity = new Entity({}),
    // we define a simple object literal that acts as a container for functions
    child = {
        name: 'childObject', // for retrieving the child later if needed
        start: function (data) {
            console.log('Logged when entity is attached (not when child is attached)');
        },
        destroy: function (data) {
            console.log('Logged when child is removed or when entity is removed');
        },
        update: function (data) {
            console.log('Logged every tick during the update loop');
        },
        draw: function (data) {
            console.log('Logged every tick during the draw loop');
        }
    };

// You can use object literals to attach or define new classes. The child could also be another Entity with a sprite!
entity.attach(child);

// attach the entity to the game
Bento.objects.attach(entity);
     * @name attach
     * @snippet #Entity.attach|Entity
attach(${1});
     * @returns {Entity} Returns itself (useful for chaining attach calls)
     */
    Entity.prototype.attach = function (child, force) {
        var parent = this,
            data = Bento.getGameData();

        if (!child) {
            Utils.log("ERROR: trying to attach " + child);
            return;
        }

        if (!child.name) {
            console.warn("WARNING: component has no name", child);
        }

        if (!force && (child.isAdded || child.parent)) {
            Utils.log("ERROR: Child " + child.name + " was already attached.");
            return;
        }

        data.entity = this;

        // attach the child
        // NOTE: attaching will always set the properties "parent" and "rootIndex"
        child.parent = this;
        child.rootIndex = this.components.length;
        this.components.push(child);
        // call child.attached
        if (child.attached) {
            child.attached(data);
        }

        // the parent entity was already added: call start on the child
        if (this.isAdded) {
            if (child.start) {
                child.start(data);
            }
        } else {
            // maybe the parent entity itself is a child, search for any grandparent that's added
            if (parent.parent) {
                parent = parent.parent;
            }
            while (parent) {
                if (parent.isAdded) {
                    if (child.start) {
                        child.start(data);
                    }
                    break;
                }
                parent = parent.parent;
            }
        }
        return this;
    };
    /**
     * Removes a child object from the entity. Note that destroy will be called in the child.
     * @function
     * @param {Object} child - The child object to remove
     * @instance
     * @name remove
     * @snippet #Entity.remove|Entity
remove();
     * @returns {Entity} Returns itself
     */
    Entity.prototype.remove = function (child) {
        var i, type, index;
        var parent = this;
        var data = Bento.getGameData();

        if (!child) {
            return;
        }
        index = this.components.indexOf(child);
        this.components[index] = null;

        if (index >= 0) {
            // the parent entity is an added entity: call destroy on the child
            if (this.isAdded) {
                if (child.destroy) {
                    child.destroy(data);
                }
            } else {
                // maybe the parent entity itself is a child, search for any grandparent that's added
                if (parent.parent) {
                    parent = parent.parent;
                }
                while (parent) {
                    if (parent.isAdded) {
                        if (child.destroy) {
                            child.destroy(data);
                        }
                        break;
                    }
                    parent = parent.parent;
                }
            }

            if (child.removed) {
                child.removed(data);
            }
            child.parent = null;
            child.rootIndex = -1; // note that sibling rootIndex may be incorrect until the next update loop
        }
        return this;
    };
    /**
     * Searches a child with certain name and removes the first result. Does nothing if not found
     * @function
     * @param {String} name - The name of the child object to remove
     * @instance
     * @name removeByName
     * @snippet #Entity.removeByName|Entity
removeByName('$1');
     * @returns {Entity} Returns itself
     */
    Entity.prototype.removeByName = function (name) {
        var entity = this;

        entity.getComponent(name, function (component) {
            entity.remove(component);
        });
        return this;
    };
    /**
     * Removes self from game (either from Bento.objects or its parent)
     * @function
     * @instance
     * @name removeSelf
     * @snippet #Entity.removeSelf|Entity
removeSelf();
     * @returns {Entity} Returns itself
     */
    Entity.prototype.removeSelf = function (name) {
        var entity = this;

        if (entity.parent) {
            // remove from parent
            entity.parent.remove(entity);
        } else if (entity.isAdded) {
            // remove from Bento.objects
            Bento.objects.remove(entity);
        }

        return this;
    };
    /**
     * Callback when component is found
     * this: refers to the component
     *
     * @callback FoundCallback
     * @param {Component} component - The component
     * @param {Number} index - Index of the component
     */
    /**
     * Returns the first child found with a certain name
     * @function
     * @instance
     * @param {String} name - name of the component
     * @param {FoundCallback} callback - called when component is found
     * @name getComponent
     * @snippet #Entity.getComponent|Entity
getComponent('${1}', function (${1:component}) {
    $2
});
     * @returns {Entity} Returns the component, null if not found
     */
    Entity.prototype.getComponent = function (name, callback) {
        var i, l, component;
        for (i = 0, l = this.components.length; i < l; ++i) {
            component = this.components[i];
            if (component && component.name === name) {
                if (callback) {
                    callback.apply(component, [component, i]);
                }
                return component;
            }
        }
        return null;
    };

    /**
     * Moves a child to a certain index in the array
     * @function
     * @instance
     * @param {Object} child - reference to the child
     * @param {Number} index - new index
     * @name moveComponentTo
     * @snippet #Entity.moveComponentTo|Entity
moveComponentTo(${1:component}, ${2:index});
     */
    Entity.prototype.moveComponentTo = function (component, newIndex) {
        // note: currently dangerous to do during an update loop
        var i, type, index;
        if (!component) {
            return;
        }
        index = this.components.indexOf(component);
        if (index >= 0) {
            // remove old
            this.components.splice(index, 1);
            // insert at new place
            this.components.splice(newIndex, 0, component);
        }
    };
    /**
     * Add this entity to a family
     * @function
     * @instance
     * @param {String} family - the family that the entity should be added to
     */
    Entity.prototype.addToFamily = function (f) {
        if (this.family.indexOf(f) !== -1) {
            return;
        }
        this.family.push(f);
        Bento.objects.addObjectToFamily(this, f);
    };
    /**
     * Remove this entity from a family
     * @function
     * @instance
     * @param {String} family - the family that this entity should be removed from
     */
    Entity.prototype.removeFromFamily = function (f) {
        var idx = this.family.indexOf(f);
        if (idx === -1) {
            return;
        }
        this.family.splice(idx, 1);
        Bento.objects.removeObjectFromFamily(this, f);
    };
    /**
     * Check if the entity is part of a family
     * @function
     * @instance
     * @param {String} family
     */
    Entity.prototype.isFamily = function (f) {
        return (this.family.indexOf(f) !== -1);
    };
    /**
     * Callback when entities collide.
     *
     * @callback CollisionCallback
     * @param {Entity} other - The other entity colliding
     */
    /**
     * Checks if entity is colliding with another entity or entities
     * @function
     * @instance
     * @param {Object} settings
     * @param {Entity} settings.entity - The other entity
     * @param {Array} settings.entities - Or an array of entities to check with
     * @param {String} settings.name - Or the other entity's name (use family for better performance)
     * @param {String} settings.family - Or the name of the family to collide with
     * @param {Entity} settings.rectangle - Or if you want to check collision with a shape directly instead of entity
     * @param {Vector2} [settings.offset] - A position offset
     * @param {CollisionCallback} [settings.onCollide] - Called when entities are colliding
     * @param {Boolean} [settings.firstOnly] - For detecting only first collision or more, default true
     * @name collidesWith
     * @snippet #Entity.collidesWith|Entity/Array
collidesWith({
    entity: obj, // when you have the reference
    entities: [], // or when colliding with this array
    name: '', // or when colliding with a single entity
    family: '', // or when colliding with a family
    rectangle: rect, // or when colliding with a rectangle
    offset: vec2, // offset the collision check on original entity's position
    firstOnly: true, // onCollide stops after having found single collision 
    onCollide: function (other) {
        // other is the other entity that is collided with
        // onCollide is not called if no collision occurred 
    }
});
     * @returns {Entity/Array} The collided entity/entities, otherwise null
     */
    // * @param {Array} settings.families - multiple families
    Entity.prototype.collidesWith = function (settings, deprecated_offset, deprecated_callback) {
        var intersect = false;
        var box;
        var otherBox;
        var i, l;
        var obj;
        var array = [];
        var offset = new Vector2(0, 0);
        var callback;
        var firstOnly = true;
        var collisions = null;
        var component;

        if (settings.isEntity) {
            // old method with parameters: collidesWith(entity, offset, callback)
            array = [settings];
            offset = deprecated_offset || offset;
            callback = deprecated_callback;
        } else if (Utils.isArray(settings)) {
            // old method with parameters: collidesWith(array, offset, callback)
            array = settings;
            offset = deprecated_offset || offset;
            callback = deprecated_callback;
        } else {
            // read settings
            offset = settings.offset || offset;
            if (Utils.isDefined(settings.firstOnly)) {
                firstOnly = settings.firstOnly;
            }
            callback = settings.onCollide;

            if (settings.entity) {
                // single entity
                if (!settings.entity.isEntity) {
                    Utils.log("WARNING: settings.entity is not an entity");
                    return null;
                }
                array = [settings.entity];
            } else if (settings.entities) {
                if (!Utils.isArray(settings.entities)) {
                    Utils.log("WARNING: settings.entities is not an array");
                    return null;
                }
                array = settings.entities;
            } else if (settings.name) {
                array = Bento.objects.getByName(settings.name);
            } else if (settings.family) {
                array = Bento.objects.getByFamily(settings.family);
            } else if (settings.rectangle) {
                array = [settings.rectangle];
            }
        }

        if (!array.length) {
            return null;
        }
        box = this.getBoundingBox().offset(offset);
        for (i = 0, l = array.length; i < l; ++i) {
            obj = array[i];

            if (obj.isEntity) {
                // ignore self collision
                if (obj.id === this.id) {
                    continue;
                }
                otherBox = obj.getBoundingBox();
            } else if (obj.isRectangle) {
                otherBox = obj;
            }
            if (box.intersect(otherBox)) {
                if (callback) {
                    callback(obj);
                }
                if (firstOnly) {
                    // return the first collision it can find
                    return obj;
                } else {
                    // collect other collisions
                    collisions = collisions || [];
                    collisions.push(obj);
                }
            }

        }
        return collisions;
    };
    /* DEPRECATED
     * Checks if entity is colliding with any entity in an array
     * Returns the first entity it finds that collides with the entity.
     * @function
     * @instance
     * @param {Object} settings
     * @param {Array} settings.entities - Array of entities, ignores self if present
     * @param {Array} settings.family - Name of family
     * @param {Vector2} [settings.offset] - A position offset
     * @param {CollisionCallback} [settings.onCollide] - Called when entities are colliding
     * @name collidesWithGroup
     * @returns {Entity} Returns the entity it collides with, null if none found
     */
    Entity.prototype.collidesWithGroup = function (settings, deprecated_offset, deprecated_callback) {
        var i, l, obj, box;
        var array, offset, callback;

        // old method with parameters
        if (Utils.isArray(settings) || Utils.isDefined(deprecated_offset) || Utils.isDefined(deprecated_callback)) {
            array = settings;
            offset = deprecated_offset || new Vector2(0, 0);
            callback = deprecated_callback;
        } else {
            array = settings.other;
            offset = settings.offset;
            callback = settings.onCollide;
        }

        if (!Utils.isArray(array)) {
            Utils.log("ERROR: Collision check must be with an Array of object");
            return;
        }
        if (!array.length) {
            return null;
        }
        box = this.getBoundingBox().offset(offset);
        for (i = 0, l = array.length; i < l; ++i) {
            obj = array[i];
            if (obj.id && obj.id === this.id) {
                continue;
            }
            if (obj.getBoundingBox && box.intersect(obj.getBoundingBox())) {
                if (callback) {
                    callback(obj);
                }
                return obj;
            }
        }
        return null;
    };

    /**
     * Transforms this entity's position to the world position
     * @function
     * @instance
     * @name getWorldPosition
     * @returns {Vector2} Returns a position
     * @snippet #Entity.getWorldPosition|Entity
getWorldPosition();
     */
    Entity.prototype.getWorldPosition = function () {
        return this.transform.getWorldPosition();
    };

    /**
     * Transforms a position local to entity's space to the world position
     * @function
     * @instance
     * @name toWorldPosition
     * @param {Vector2} localPosition - A position to transform to world position
     * @returns {Vector2} Returns a position
     */
    Entity.prototype.toWorldPosition = function (localPosition) {
        return this.transform.toWorldPosition(localPosition);
    };
    /**
     * Transforms a world position to the entity's local position
     * @function
     * @instance
     * @name toLocalPosition
     * @param {Vector2} worldPosition - A position to transform to local position
     * @returns {Vector2} Returns a position relative to the entity
     */
    Entity.prototype.toLocalPosition = function (worldPosition) {
        return this.transform.toLocalPosition(worldPosition);
    };

    /**
     * Transforms a world position to the same space as the entity's
     * @function
     * @instance
     * @name toComparablePosition
     * @param {Vector2} worldPosition - A vector2 to transform
     * @returns {Vector2} Returns a position relative to the entity's parent
     * @snippet #Entity.toComparablePosition|Entity
toComparablePosition(${1:worldPosition});
     */
    Entity.prototype.toComparablePosition = function (worldPosition) {
        return this.transform.toComparablePosition(worldPosition);
    };

    /*
     * Implementations of callback functions from here on.
     * These are the functions that the Entity passes to it's children (components).
     * The developer shouldn't need to call these functions themselves.
     * Overwrite only if you know what you're doing
     */
    Entity.prototype.start = function (data) {
        var i,
            l,
            component;
        data = data || Bento.getGameData();
        // update components
        for (i = 0, l = this.components.length; i < l; ++i) {
            component = this.components[i];
            if (component && component.start) {
                data.entity = this;
                component.start(data);
            }
        }
    };
    Entity.prototype.destroy = function (data) {
        var i,
            l,
            component,
            components = this.components;
        data = data || Bento.getGameData();
        // update components
        for (i = 0, l = components.length; i < l; ++i) {
            component = components[i];
            if (component && component.destroy) {
                data.entity = this;
                component.destroy(data);
            }
        }
    };
    Entity.prototype.update = function (data) {
        var i,
            l,
            component,
            components = this.components;

        data = data || Bento.getGameData();
        // update components
        for (i = 0, l = components.length; i < l; ++i) {
            component = components[i];
            if (component && component.update) {
                this.currentComponent = component;
                data.entity = this;
                component.rootIndex = i;
                component.update(data);
            }
        }

        this.timer += data.speed;
        this.ticker += 1;

        // clean up
        cleanComponents(this);
        this.currentComponent = null;
    };
    Entity.prototype.draw = function (data) {
        var i, l, component;
        var components = this.components;
        var matrix;
        if (!this.visible || !this.transform.visible) {
            return;
        }
        data = data || Bento.getGameData();

        this.transform.draw(data);

        // call components
        for (i = 0, l = components.length; i < l; ++i) {
            component = components[i];
            if (component && component.draw) {
                this.currentComponent = component;
                data.entity = this;
                component.draw(data);
            }
        }
        // post draw
        for (i = components.length - 1; i >= 0; i--) {
            component = components[i];
            if (component && component.postDraw) {
                data.entity = this;
                component.postDraw(data);
            }
        }

        this.transform.postDraw(data);
        this.currentComponent = null;
    };
    /*
     * Entity was attached, calls onParentAttach to all children
     */
    Entity.prototype.attached = function (data) {
        var i,
            l,
            component;

        data = data || Bento.getGameData();
        data.entity = this;
        data.parent = this.parent;

        // update components
        for (i = 0, l = this.components.length; i < l; ++i) {
            component = this.components[i];
            if (component) {
                if (component.onParentAttached) {
                    data.entity = this;
                    component.onParentAttached(data);
                }
            }
        }
    };
    /*
     * Entity was removed, calls onParentRemoved to all children
     */
    Entity.prototype.removed = function (data) {
        var i,
            l,
            component;

        data = data || Bento.getGameData();
        data.entity = this;
        data.parent = this.parent;

        // update components
        for (i = 0, l = this.components.length; i < l; ++i) {
            component = this.components[i];
            if (component) {
                if (component.onParentRemoved) {
                    data.entity = this;
                    component.onParentRemoved(data);
                }
            }
        }
    };
    /* DEPRECATED
     * Calls onParentCollided on every child, additionally calls onCollide on self afterwards
     */
    Entity.prototype.collided = function (data) {
        var i,
            l,
            component;

        if (data) {
            data.entity = this;
            data.parent = this.parent;
        } else {
            throw "Must pass a data object";
        }
        // update components
        for (i = 0, l = this.components.length; i < l; ++i) {
            component = this.components[i];
            if (component) {
                if (component.onParentCollided) {
                    data.entity = this;
                    component.onParentCollided(data);
                }
            }
        }
        if (this.onCollide) {
            this.onCollide(data.other);
        }
    };

    Entity.prototype.toString = function () {
        return '[object Entity]';
    };

    return Entity;
});
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
    
    var isLooping = {};  // Mapping of event name to bool (true if this event is currently being looped over)
    var events = {};     // Mapping of event name to array[{callback:Function, context:Object}]
    var removed = {};    // Mapping of event name to array[{callback:Function, context:Object}]

    // Clear the looping status of all events if an unhandled exception occurs.
    // Without this, the event would be blocked from ever occuring again.
    window.addEventListener('error', function (errorEvent) {
        isLooping = {};
    });

    // Clean a single event
    // (remove any listeners that are queued for removal)
    var cleanEvent = function (eventName) {
        var i, j, l, callback, context;

        var removedEvents = removed[eventName];
        var listeners = events[eventName];
        if (!listeners || !removedEvents) {
            return;
        }

        for (j = 0, l = removedEvents.length; j < l; ++j) {
            if (removedEvents[j].reset) {
                // reset the whole event listener
                events[eventName] = [];
                break;
            }
            callback = removedEvents[j].callback;
            context = removedEvents[j].context;
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
        removed[eventName] = [];
    };

    var addEventListener = function (eventName, callback, context) {
        if (Utils.isUndefined(events[eventName])) {
            events[eventName] = [];
            isLooping[eventName] = false;
            removed[eventName] = [];
        }
        events[eventName].push({
            callback: callback,
            context: context
        });
    };

    var removeEventListener = function (eventName, callback, context) {
        var i, listeners, removedEvents;
        
        listeners = events[eventName];
        removedEvents = removed[eventName];
        if (!listeners || !removedEvents) {
            return;
        }

        if (isLooping[eventName]) {
            // remove this event after we are done looping over it
            removedEvents.push({
                callback: callback,
                context: context
            });
        } else {
            // remove this event immediately
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
    };

    var clearEventListeners = function (eventName) {
        var listeners = events[eventName];
        var removedEvents = removed[eventName];

        if (!listeners || !removedEvents) {
            return;
        }
        if (isLooping[eventName]) {
            // reset the whole event after we're done looping over it
            removedEvents.push({
                reset: true
            });
        } else {
            // reset the whole event now
            events[eventName] = [];
        }
    };
    var stopPropagation = false;
    var EventSystem = {
        SortedEventSystem: null,
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
            cleanEvent(eventName);

            if (!Utils.isString(eventName)) {
                eventName = eventName.toString();
            }
            if (Utils.isUndefined(events[eventName])) {
                return;
            }
            listeners = events[eventName];
            if (isLooping[eventName]) {
                Utils.log('ERROR: Already looping over event "' + eventName + '"');
                return;
            }
            isLooping[eventName] = true;

            for (i = 0, l = listeners.length; i < l; ++i) {
                listener = listeners[i];
                if (listener) {
                    if (listener.context) {
                        listener.callback.apply(listener.context, [eventData]);
                    } else {
                        listener.callback(eventData);
                    }
                }
                if (stopPropagation) {
                    stopPropagation = false;
                    break;
                }

            }
            isLooping[eventName] = false;
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
/*
    Audia: <audio> implemented using the Web Audio API
    by Matt Hackett of Lost Decade Games
    AMD port by sprky0
    https://github.com/richtaur/audia
    https://github.com/sprky0/audia

    Adapted for Bento game engine by Lucky Kat Studios
*/
bento.define("audia", [
    'bento/utils'
], function (
    Utils
) {

    // Got Web Audio API?
    var audioContext = null;
    if (typeof AudioContext == "function") {
        audioContext = new AudioContext();
    } else if (window.webkitAudioContext) {
        audioContext = new webkitAudioContext();
    }

    // Setup
    var AudiaConstructor;
    var hasWebAudio = Boolean(audioContext);

    // Audia object creation
    var audioId = 0;
    var audiaObjectsCache = {};
    var addAudiaObject = function (object) {
        var id = ++audioId;
        audiaObjectsCache[id] = object;

        return id;
    };
    // Math helper
    var clamp = function (value, min, max) {
        return Math.min(Math.max(Number(value), min), max);
    };
    var setupWebAudio = function () {
        // Reimplement Audio using Web Audio API…

        // Load audio helper
        var buffersCache = {};
        var loadAudioFile = function (object, url) {
            var onLoad = function (buffer) {
                // Duration
                if (buffer.duration !== object._duration) {
                    object._duration = buffer.duration;
                    object.dispatchEvent("durationchange" /*, TODO*/ );
                }

                object.dispatchEvent("canplay" /*, TODO*/ );
                object.dispatchEvent("canplaythrough" /*, TODO*/ );
                object.dispatchEvent("load" /*, TODO*/ );

                object._autoplay && object.play();
                object._onload && object.onload();
            };

            // Got a cached buffer or should we fetch it?
            if (url in buffersCache) {
                onLoad(buffersCache[url]);
            } else {
                var xhr = new XMLHttpRequest();
                xhr.open("GET", url, true);
                xhr.responseType = "arraybuffer";
                xhr.onload = function () {
                    audioContext.decodeAudioData(xhr.response, function (buffer) {
                        buffersCache[url] = buffer;
                        onLoad(buffer);
                    });
                };
                xhr.send();
            }
        };

        var refreshBufferSource = function (object) {
            // Create (or replace) buffer source
            object.bufferSource = audioContext.createBufferSource();

            // Attach buffer to buffer source
            object.bufferSource.buffer = buffersCache[object.src];

            // Connect to gain node
            object.bufferSource.connect(object.gainNode);

            // Update settings
            object.bufferSource.loop = object._loop;
            object.bufferSource.onended = object._onended;
        };

        // Setup a master gain node
        var gainNode = audioContext.createGain();
        gainNode.gain.value = 1;
        gainNode.connect(audioContext.destination);

        // Constructor
        var Audia = function (src) {
            this.id = addAudiaObject(this);

            // Setup
            this._listenerId = 0;
            this._listeners = {};

            // Audio properties
            this._autoplay = false;
            this._buffered = []; // TimeRanges
            this._currentSrc = "";
            this._currentTime = 0;
            this._defaultPlaybackRate = 1;
            this._duration = NaN;
            this._loop = false;
            this._muted = false;
            this._paused = true;
            this._playbackRate = 1;
            this._played = []; // TimeRanges
            this._preload = "auto";
            this._seekable = []; // TimeRanges
            this._seeking = false;
            this._src = "";
            this._volume = 1;
            this._onended = null;
            this._onload = null;

            // Create gain node
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = this._volume;

            // Connect to master gain node
            this.gainNode.connect(gainNode);

            // Support for new Audia(src)
            if (src !== undefined) {
                this.src = src;
            }
        };

        // Methods…

        // load
        Audia.prototype.load = function () {
            // TODO: find out what it takes for this to fire
            // proably just needs src set right?
            this._src && loadAudioFile(this, this._src);
        };

        // play()
        Audia.prototype.play = function () {
            // TODO: restart from this.currentTime
            this._paused = false;

            refreshBufferSource(this);
            if (this.bufferSource.start)
                this.bufferSource.start(0);
            else
                this.bufferSource.noteOn(0);
        };

        // pause()
        Audia.prototype.pause = function () {
            if (this._paused) {
                return;
            }
            this._paused = true;

            if (this.bufferSource.stop)
                this.bufferSource.stop(0);
            else
                this.bufferSource.noteOff(0);
        };

        // stop()
        Audia.prototype.stop = function () {
            if (this._paused) {
                return;
            }

            this.pause();
            this.currentTime = 0;
        };

        // addEventListener()
        Audia.prototype.addEventListener = function (eventName, callback /*, capture*/ ) {
            this._listeners[++this._listenerKey] = {
                eventName: eventName,
                callback: callback
            };
        };

        // dispatchEvent()
        Audia.prototype.dispatchEvent = function (eventName, args) {
            for (var id in this._listeners) {
                var listener = this._listeners[id];
                if (listener.eventName == eventName) {
                    listener.callback && listener.callback.apply(listener.callback, args);
                }
            }
        };

        // removeEventListener()
        Audia.prototype.removeEventListener = function (eventName, callback /*, capture*/ ) {
            // Get the id of the listener to remove
            var listenerId = null;
            for (var id in this._listeners) {
                var listener = this._listeners[id];
                if (listener.eventName === eventName) {
                    if (listener.callback === callback) {
                        listenerId = id;
                        break;
                    }
                }
            }

            // Delete the listener
            if (listenerId !== null) {
                delete this._listeners[listenerId];
            }
        };

        // Properties…

        // autoplay (Boolean)
        Object.defineProperty(Audia.prototype, "autoplay", {
            get: function () {
                return this._autoplay;
            },
            set: function (value) {
                this._autoplay = value;
            }
        });

        // buffered (TimeRanges)
        Object.defineProperty(Audia.prototype, "buffered", {
            get: function () {
                return this._buffered;
            }
        });

        // currentSrc (String)
        Object.defineProperty(Audia.prototype, "currentSrc", {
            get: function () {
                return this._currentSrc;
            }
        });

        // currentTime (Number)
        Object.defineProperty(Audia.prototype, "currentTime", {
            get: function () {
                return this._currentTime;
            },
            set: function (value) {
                this._currentTime = value;
                // TODO
                // TODO: throw errors appropriately (eg DOM error)
            }
        });

        // defaultPlaybackRate (Number) (default: 1)
        Object.defineProperty(Audia.prototype, "defaultPlaybackRate", {
            get: function () {
                return Number(this._defaultPlaybackRate);
            },
            set: function (value) {
                this._defaultPlaybackRate = value;
                // todo
            }
        });

        // duration (Number)
        Object.defineProperty(Audia.prototype, "duration", {
            get: function () {
                return this._duration;
            }
        });

        // loop (Boolean)
        Object.defineProperty(Audia.prototype, "loop", {
            get: function () {
                return this._loop;
            },
            set: function (value) {
                // TODO: buggy, needs revisit
                if (this._loop === value) {
                    return;
                }
                this._loop = value;

                if (!this.bufferSource) {
                    return;
                }

                if (this._paused) {
                    refreshBufferSource(this);
                    this.bufferSource.loop = value;
                } else {
                    this.pause();
                    refreshBufferSource(this);
                    this.bufferSource.loop = value;
                    this.play();
                }
            }
        });

        // muted (Boolean)
        Object.defineProperty(Audia.prototype, "muted", {
            get: function () {
                return this._muted;
            },
            set: function (value) {
                this._muted = value;
                this.gainNode.gain.value = value ? 0 : this._volume;
            }
        });

        // paused (Boolean)
        Object.defineProperty(Audia.prototype, "paused", {
            get: function () {
                return this._paused;
            }
        });

        // playbackRate (Number) (default: 1)
        Object.defineProperty(Audia.prototype, "playbackRate", {
            get: function () {
                return this._playbackRate;
            },
            set: function (value) {
                this._playbackRate = value;
                // todo
            }
        });

        // played (Boolean)
        Object.defineProperty(Audia.prototype, "played", {
            get: function () {
                return this._played;
            }
        });

        // preload (String)
        Object.defineProperty(Audia.prototype, "preload", {
            get: function () {
                return this._preload;
            },
            set: function (value) {
                this._preload = value;
                // TODO
            }
        });

        // seekable (Boolean)
        Object.defineProperty(Audia.prototype, "seekable", {
            get: function () {
                return this._seekable;
            }
        });

        // seeking (Boolean)
        Object.defineProperty(Audia.prototype, "seeking", {
            get: function () {
                return this._seeking;
            }
        });

        // src (String)
        Object.defineProperty(Audia.prototype, "src", {
            get: function () {
                return this._src;
            },
            set: function (value) {
                this._src = value;
                loadAudioFile(this, value);
            }
        });

        // volume (Number) (range: 0-1) (default: 1)
        Object.defineProperty(Audia.prototype, "volume", {
            get: function () {
                return this._volume;
            },
            set: function (value) {
                // Emulate Audio by throwing an error if volume is out of bounds
                if (!Audia.preventErrors) {
                    if (clamp(value, 0, 1) !== value) {
                        // TODO: throw DOM error
                    }
                }

                if (value < 0) {
                    value = 0;
                }
                this._volume = value;

                // Don't bother if we're muted!
                if (this._muted) {
                    return;
                }

                this.gainNode.gain.value = value;

                this.dispatchEvent("volumechange" /*, TODO*/ );
            }
        });

        Object.defineProperty(Audia.prototype, "onended", {
            get: function () {
                return this._onended;
            },
            set: function (value) {
                this._onended = value;
            }
        });
        Object.defineProperty(Audia.prototype, "onload", {
            get: function () {
                return this._onload;
            },
            set: function (value) {
                this._onload = value;
            }
        });
        addProperties(Audia);
        return Audia;
    };
    var setupHtml5Audio = function () {

        // Create a thin wrapper around the Audio object…

        // Constructor
        var Audia = function (src) {
            this.id = addAudiaObject(this);
            this._audioNode = new Audio();

            // Support for new Audia(src)
            if (src !== undefined) {
                this.src = src;
            }
        };

        // Methods…

        // load
        Audia.prototype.load = function (type) {
            this._audioNode.load();
        };

        // play()
        Audia.prototype.play = function (currentTime) {
            if (currentTime !== undefined) {
                this._audioNode.currentTime = currentTime;
            }
            this._audioNode.play();
        };

        // pause()
        Audia.prototype.pause = function () {
            this._audioNode.pause();
        };

        // stop()
        Audia.prototype.stop = function () {
            this._audioNode.pause();
            this._audioNode.currentTime = 0;
        };

        // addEventListener()
        Audia.prototype.addEventListener = function (eventName, callback, capture) {
            this._audioNode.addEventListener(eventName, callback, capture);
        };

        // removeEventListener()
        Audia.prototype.removeEventListener = function (eventName, callback, capture) {
            this._audioNode.removeEventListener(eventName, callback, capture);
        };

        // Properties…

        // autoplay (Boolean)
        Object.defineProperty(Audia.prototype, "autoplay", {
            get: function () {
                return this._audioNode.autoplay;
            },
            set: function (value) {
                this._audioNode.autoplay = value;
            }
        });

        // buffered (TimeRanges)
        Object.defineProperty(Audia.prototype, "buffered", {
            get: function () {
                return this._audioNode.buffered;
            }
        });

        // currentSrc (String)
        Object.defineProperty(Audia.prototype, "currentSrc", {
            get: function () {
                return this._audioNode.src;
            }
        });

        // currentTime (Number)
        Object.defineProperty(Audia.prototype, "currentTime", {
            get: function () {
                return this._audioNode.currentTime;
            },
            set: function (value) {
                this._audioNode.currentTime = value;
            }
        });

        // defaultPlaybackRate (Number) (default: 1)
        Object.defineProperty(Audia.prototype, "defaultPlaybackRate", {
            get: function () {
                return this._audioNode.defaultPlaybackRate;
            },
            set: function (value) {
                // TODO: not being used ATM
                this._audioNode.defaultPlaybackRate = value;
            }
        });

        // duration (Number)
        Object.defineProperty(Audia.prototype, "duration", {
            get: function () {
                return this._audioNode.duration;
            }
        });

        // loop (Boolean)
        Object.defineProperty(Audia.prototype, "loop", {
            get: function () {
                return this._audioNode.loop;
            },
            set: function (value) {
                // Fixes a bug in Chrome where audio will not play if currentTime
                // is at the end of the song
                if (this._audioNode.currentTime >= this._audioNode.duration) {
                    this._audioNode.currentTime = 0;
                }

                this._audioNode.loop = value;
            }
        });

        // muted (Boolean)
        Object.defineProperty(Audia.prototype, "muted", {
            get: function () {
                return this._audioNode.muted;
            },
            set: function (value) {
                this._audioNode.muted = value;
            }
        });

        // paused (Boolean)
        Object.defineProperty(Audia.prototype, "paused", {
            get: function () {
                return this._audioNode.paused;
            }
        });

        // playbackRate (Number) (default: 1)
        Object.defineProperty(Audia.prototype, "playbackRate", {
            get: function () {
                return this._audioNode.playbackRate;
            },
            set: function (value) {
                this._audioNode.playbackRate = value;
            }
        });

        // played (Boolean)
        Object.defineProperty(Audia.prototype, "played", {
            get: function () {
                return this._audioNode.played;
            }
        });

        // preload (String)
        Object.defineProperty(Audia.prototype, "preload", {
            get: function () {
                return this._audioNode.preload;
            },
            set: function (value) {
                this._audioNode.preload = value;
            }
        });

        // seekable (Boolean)
        Object.defineProperty(Audia.prototype, "seekable", {
            get: function () {
                return this._audioNode.seekable;
            }
        });

        // seeking (Boolean)
        Object.defineProperty(Audia.prototype, "seeking", {
            get: function () {
                return this._audioNode.seeking;
            }
        });

        // src (String)
        Object.defineProperty(Audia.prototype, "src", {
            get: function () {
                return this._audioNode.src;
            },
            set: function (value) {
                var self = this,
                    listener = function () {
                        if (self.onload) {
                            self.onload();
                        }
                        // clear the event listener
                        self._audioNode.removeEventListener('canplaythrough', listener, false);
                    };
                this._audioNode.src = value;
                this._audioNode.preload = "auto";
                this._audioNode.addEventListener('canplaythrough', listener, false);
                this._audioNode.addEventListener('error', function (e) {
                    console.log('audio load error', self._audioNode.error);
                }, false);
                this._audioNode.load();
            }
        });

        // volume (Number) (range: 0-1) (default: 1)
        Object.defineProperty(Audia.prototype, "volume", {
            get: function () {
                return this._audioNode.volume;
            },
            set: function (value) {
                if (Audia.preventErrors) {
                    var value = clamp(value, 0, 1);
                }
                this._audioNode.volume = value;
            }
        });
        Object.defineProperty(Audia.prototype, "onended", {
            get: function () {
                return this._audioNode.onended;
            },
            set: function (value) {
                this._audioNode.onended = value;
            }
        });

        Object.defineProperty(Audia.prototype, "onload", {
            get: function () {
                return this._audioNode.onload;
            },
            set: function (value) {
                this._audioNode.onload = value;
            }
        });

        addProperties(Audia);

        return Audia;
    };
    var addProperties = function (Audia) {
        // Prevent errors?
        Audia.preventErrors = true;

        // Public helper
        Object.defineProperty(Audia, "hasWebAudio", {
            get: function () {
                return hasWebAudio;
            }
        });

        // Audio context
        Object.defineProperty(Audia, "audioContext", {
            get: function () {
                return audioContext;
            }
        });

        // Gain node
        Object.defineProperty(Audia, "gainNode", {
            get: function () {
                return gainNode;
            }
        });

        // Version
        Object.defineProperty(Audia, "version", {
            get: function () {
                return "0.3.0";
            }
        });

        // canPlayType helper
        // Can be called with shortcuts, e.g. "mp3" instead of "audio/mp3"
        var audioNode;
        Audia.canPlayType = function (type) {
            if (hasWebAudio && Utils.isApple()) {
                // bug in iOS Safari: will not respect the mute if an audionode is instantiated
                // manual type checking: ogg not supported
                if (type.indexOf('ogg') >= 0) {
                    return false;
                } else if (type.indexOf('mp3') >= 0) {
                    return true;
                }
                return true;
            } else {
                if (audioNode === undefined) {
                    audioNode = new Audio();
                }
                type = (type.match("/") === null ? "audio/" : "") + type;
                return audioNode.canPlayType(type);
            }

        };

        // canPlayType
        Audia.prototype.canPlayType = function (type) {
            return Audia.canPlayType(type);
        };

        // Lastly, wrap all "on" properties up into the events
        var eventNames = [
            "abort",
            "canplay",
            "canplaythrough",
            "durationchange",
            "emptied",
            //"ended",
            "error",
            "loadeddata",
            "loadedmetadata",
            "loadstart",
            "pause",
            "play",
            "playing",
            "progress",
            "ratechange",
            "seeked",
            "seeking",
            "stalled",
            "suspend",
            "timeupdate",
            "volumechange"
        ];

        for (var i = 0, j = eventNames.length; i < j; ++i) {
            (function (eventName) {
                var fauxPrivateName = "_on" + eventName;
                Audia.prototype[fauxPrivateName] = null;
                Object.defineProperty(Audia.prototype, "on" + eventName, {
                    get: function () {
                        return this[fauxPrivateName];
                    },
                    set: function (value) {
                        // Remove the old listener
                        if (this[fauxPrivateName]) {
                            this.removeEventListener(eventName, this[fauxPrivateName], false);
                        }

                        // Only set functions
                        if (typeof value == "function") {
                            this[fauxPrivateName] = value;
                            this.addEventListener(eventName, value, false);
                        } else {
                            this[fauxPrivateName] = null;
                        }
                    }
                });
            })(eventNames[i]);
        }

        // get alternative constructors
        Audia.getWebAudia = setupWebAudio;
        Audia.getHtmlAudia = setupHtml5Audio;
    };

    // Which approach are we taking?…
    if (hasWebAudio) {
        AudiaConstructor = setupWebAudio();
    } else {
        AudiaConstructor = setupHtml5Audio();
    }

    return AudiaConstructor;
});

/*
BSD License, yo: http://en.wikipedia.org/wiki/BSD_licenses

Copyright yada yada 2011 Matt Hackett (http://www.richtaur.com/). All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED "AS IS" AND ANY EXPRESS OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The views and conclusions contained in the software and documentation are those of the
author(s) and should not be interpreted as representing official policies, either expressed
or implied, of the author(s).
*/
/**
 * @license RequireJS domReady 2.0.1 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/domReady for details
 */
/*jslint*/
/*global require: false, define: false, requirejs: false,
  window: false, clearInterval: false, document: false,
  self: false, setInterval: false */


bento.define('bento/lib/domready', [], function () {
    'use strict';

    var isTop, testDiv, scrollIntervalId,
        isBrowser = typeof window !== "undefined" && window.document,
        isPageLoaded = !isBrowser,
        doc = isBrowser ? document : null,
        readyCalls = [];

    function runCallbacks(callbacks) {
        var i;
        for (i = 0; i < callbacks.length; i += 1) {
            callbacks[i](doc);
        }
    }

    function callReady() {
        var callbacks = readyCalls;

        if (isPageLoaded) {
            //Call the DOM ready callbacks
            if (callbacks.length) {
                readyCalls = [];
                runCallbacks(callbacks);
            }
        }
    }

    /**
     * Sets the page as loaded.
     */
    function pageLoaded() {
        if (!isPageLoaded) {
            isPageLoaded = true;
            if (scrollIntervalId) {
                clearInterval(scrollIntervalId);
            }

            callReady();
        }
    }

    if (isBrowser) {
        if (document.addEventListener) {
            //Standards. Hooray! Assumption here that if standards based,
            //it knows about DOMContentLoaded.
            document.addEventListener("DOMContentLoaded", pageLoaded, false);
            window.addEventListener("load", pageLoaded, false);
        } else if (window.attachEvent) {
            window.attachEvent("onload", pageLoaded);

            testDiv = document.createElement('div');
            try {
                isTop = window.frameElement === null;
            } catch (e) {}

            //DOMContentLoaded approximation that uses a doScroll, as found by
            //Diego Perini: http://javascript.nwbox.com/IEContentLoaded/,
            //but modified by other contributors, including jdalton
            if (testDiv.doScroll && isTop && window.external) {
                scrollIntervalId = setInterval(function () {
                    try {
                        testDiv.doScroll();
                        pageLoaded();
                    } catch (e) {}
                }, 30);
            }
        }

        //Check if document already complete, and if so, just trigger page load
        //listeners. Latest webkit browsers also use "interactive", and
        //will fire the onDOMContentLoaded before "interactive" but not after
        //entering "interactive" or "complete". More details:
        //http://dev.w3.org/html5/spec/the-end.html#the-end
        //http://stackoverflow.com/questions/3665561/document-readystate-of-interactive-vs-ondomcontentloaded
        //Hmm, this is more complicated on further use, see "firing too early"
        //bug: https://github.com/requirejs/domReady/issues/1
        //so removing the || document.readyState === "interactive" test.
        //There is still a window.onload binding that should get fired if
        //DOMContentLoaded is missed.
        if (document.readyState === "complete") {
            pageLoaded();
        }
    }

    /** START OF PUBLIC API **/

    /**
     * Registers a callback for DOM ready. If DOM is already ready, the
     * callback is called immediately.
     * @param {Function} callback
     */
    function domReady(callback) {
        if (isPageLoaded) {
            callback(doc);
        } else {
            readyCalls.push(callback);
        }
        return domReady;
    }

    domReady.version = '2.0.1';

    /**
     * Loader Plugin API method
     */
    domReady.load = function (name, req, onLoad, config) {
        if (config.isBuild) {
            onLoad(null);
        } else {
            domReady(onLoad);
        }
    };

    /** END OF PUBLIC API **/

    return domReady;
});

/**
 * https://github.com/pieroxy/lz-string/
 * Modifications: wrapped in Bento define
 *
 * Copyright (c) 2013 Pieroxy <pieroxy@pieroxy.net>
 * This work is free. You can redistribute it and/or modify it
 * under the terms of the WTFPL, Version 2
 * For more information see LICENSE.txt or http://www.wtfpl.net/
 *
 * For more information, the home page:
 * http://pieroxy.net/blog/pages/lz-string/testing.html
 *
 * LZ-based compression algorithm, version 1.4.4
 *
 * @module lzstring
 * @moduleName LZString
 * @returns LZString
 */
bento.define('lzstring', [], function () {
    // private property
    var f = String.fromCharCode;
    var keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
    var baseReverseDic = {};

    function getBaseValue(alphabet, character) {
        if (!baseReverseDic[alphabet]) {
            baseReverseDic[alphabet] = {};
            for (var i = 0, l = alphabet.length; i < l; i++) {
                baseReverseDic[alphabet][alphabet.charAt(i)] = i;
            }
        }
        return baseReverseDic[alphabet][character];
    }

    var LZString = {
        compressToBase64: function (input) {
            if (input == null) return "";
            var res = LZString._compress(input, 6, function (a) {
                return keyStrBase64.charAt(a);
            });
            switch (res.length % 4) { // To produce valid Base64
                default: // When could this happen ?
            case 0:
                return res;
            case 1:
                return res + "===";
            case 2:
                return res + "==";
            case 3:
                return res + "=";
            }
        },

        decompressFromBase64: function (input) {
            if (input == null) return "";
            if (input == "") return null;
            return LZString._decompress(input.length, 32, function (index) {
                return getBaseValue(keyStrBase64, input.charAt(index));
            });
        },

        compressToUTF16: function (input) {
            if (input == null) return "";
            return LZString._compress(input, 15, function (a) {
                return f(a + 32);
            }) + " ";
        },

        decompressFromUTF16: function (compressed) {
            if (compressed == null) return "";
            if (compressed == "") return null;
            return LZString._decompress(compressed.length, 16384, function (index) {
                return compressed.charCodeAt(index) - 32;
            });
        },

        //compress into uint8array (UCS-2 big endian format)
        compressToUint8Array: function (uncompressed) {
            var compressed = LZString.compress(uncompressed);
            var buf = new Uint8Array(compressed.length * 2); // 2 bytes per character

            for (var i = 0, TotalLen = compressed.length; i < TotalLen; i++) {
                var current_value = compressed.charCodeAt(i);
                buf[i * 2] = current_value >>> 8;
                buf[i * 2 + 1] = current_value % 256;
            }
            return buf;
        },

        //decompress from uint8array (UCS-2 big endian format)
        decompressFromUint8Array: function (compressed) {
            if (compressed === null || compressed === undefined) {
                return LZString.decompress(compressed);
            } else {
                var buf = new Array(compressed.length / 2); // 2 bytes per character
                for (var i = 0, TotalLen = buf.length; i < TotalLen; i++) {
                    buf[i] = compressed[i * 2] * 256 + compressed[i * 2 + 1];
                }

                var result = [];
                buf.forEach(function (c) {
                    result.push(f(c));
                });
                return LZString.decompress(result.join(''));

            }

        },


        //compress into a string that is already URI encoded
        compressToEncodedURIComponent: function (input) {
            if (input == null) return "";
            return LZString._compress(input, 6, function (a) {
                return keyStrUriSafe.charAt(a);
            });
        },

        //decompress from an output of compressToEncodedURIComponent
        decompressFromEncodedURIComponent: function (input) {
            if (input == null) return "";
            if (input == "") return null;
            input = input.replace(/ /g, "+");
            return LZString._decompress(input.length, 32, function (index) {
                return getBaseValue(keyStrUriSafe, input.charAt(index));
            });
        },

        compress: function (uncompressed) {
            return LZString._compress(uncompressed, 16, function (a) {
                return f(a);
            });
        },
        _compress: function (uncompressed, bitsPerChar, getCharFromInt) {
            if (uncompressed == null) return "";
            var i, value,
                context_dictionary = {},
                context_dictionaryToCreate = {},
                context_c = "",
                context_wc = "",
                context_w = "",
                context_enlargeIn = 2, // Compensate for the first entry which should not count
                context_dictSize = 3,
                context_numBits = 2,
                context_data = [],
                context_data_val = 0,
                context_data_position = 0,
                ii, l;

            for (ii = 0, l = uncompressed.length; ii < l; ii += 1) {
                context_c = uncompressed.charAt(ii);
                if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
                    context_dictionary[context_c] = context_dictSize++;
                    context_dictionaryToCreate[context_c] = true;
                }

                context_wc = context_w + context_c;
                if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
                    context_w = context_wc;
                } else {
                    if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                        if (context_w.charCodeAt(0) < 256) {
                            for (i = 0; i < context_numBits; i++) {
                                context_data_val = (context_data_val << 1);
                                if (context_data_position == bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else {
                                    context_data_position++;
                                }
                            }
                            value = context_w.charCodeAt(0);
                            for (i = 0; i < 8; i++) {
                                context_data_val = (context_data_val << 1) | (value & 1);
                                if (context_data_position == bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else {
                                    context_data_position++;
                                }
                                value = value >> 1;
                            }
                        } else {
                            value = 1;
                            for (i = 0; i < context_numBits; i++) {
                                context_data_val = (context_data_val << 1) | value;
                                if (context_data_position == bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else {
                                    context_data_position++;
                                }
                                value = 0;
                            }
                            value = context_w.charCodeAt(0);
                            for (i = 0; i < 16; i++) {
                                context_data_val = (context_data_val << 1) | (value & 1);
                                if (context_data_position == bitsPerChar - 1) {
                                    context_data_position = 0;
                                    context_data.push(getCharFromInt(context_data_val));
                                    context_data_val = 0;
                                } else {
                                    context_data_position++;
                                }
                                value = value >> 1;
                            }
                        }
                        context_enlargeIn--;
                        if (context_enlargeIn == 0) {
                            context_enlargeIn = Math.pow(2, context_numBits);
                            context_numBits++;
                        }
                        delete context_dictionaryToCreate[context_w];
                    } else {
                        value = context_dictionary[context_w];
                        for (i = 0; i < context_numBits; i++) {
                            context_data_val = (context_data_val << 1) | (value & 1);
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                            value = value >> 1;
                        }


                    }
                    context_enlargeIn--;
                    if (context_enlargeIn == 0) {
                        context_enlargeIn = Math.pow(2, context_numBits);
                        context_numBits++;
                    }
                    // Add wc to the dictionary.
                    context_dictionary[context_wc] = context_dictSize++;
                    context_w = String(context_c);
                }
            }

            // Output the code for w.
            if (context_w !== "") {
                if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                    if (context_w.charCodeAt(0) < 256) {
                        for (i = 0; i < context_numBits; i++) {
                            context_data_val = (context_data_val << 1);
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                        }
                        value = context_w.charCodeAt(0);
                        for (i = 0; i < 8; i++) {
                            context_data_val = (context_data_val << 1) | (value & 1);
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                            value = value >> 1;
                        }
                    } else {
                        value = 1;
                        for (i = 0; i < context_numBits; i++) {
                            context_data_val = (context_data_val << 1) | value;
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                            value = 0;
                        }
                        value = context_w.charCodeAt(0);
                        for (i = 0; i < 16; i++) {
                            context_data_val = (context_data_val << 1) | (value & 1);
                            if (context_data_position == bitsPerChar - 1) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                            value = value >> 1;
                        }
                    }
                    context_enlargeIn--;
                    if (context_enlargeIn == 0) {
                        context_enlargeIn = Math.pow(2, context_numBits);
                        context_numBits++;
                    }
                    delete context_dictionaryToCreate[context_w];
                } else {
                    value = context_dictionary[context_w];
                    for (i = 0; i < context_numBits; i++) {
                        context_data_val = (context_data_val << 1) | (value & 1);
                        if (context_data_position == bitsPerChar - 1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = value >> 1;
                    }


                }
                context_enlargeIn--;
                if (context_enlargeIn == 0) {
                    context_enlargeIn = Math.pow(2, context_numBits);
                    context_numBits++;
                }
            }

            // Mark the end of the stream
            value = 2;
            for (i = 0; i < context_numBits; i++) {
                context_data_val = (context_data_val << 1) | (value & 1);
                if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                } else {
                    context_data_position++;
                }
                value = value >> 1;
            }

            // Flush the last char
            while (true) {
                context_data_val = (context_data_val << 1);
                if (context_data_position == bitsPerChar - 1) {
                    context_data.push(getCharFromInt(context_data_val));
                    break;
                } else context_data_position++;
            }
            return context_data.join('');
        },

        decompress: function (compressed) {
            if (compressed == null) return "";
            if (compressed == "") return null;
            return LZString._decompress(compressed.length, 32768, function (index) {
                return compressed.charCodeAt(index);
            });
        },

        _decompress: function (length, resetValue, getNextValue) {
            var dictionary = [],
                next,
                enlargeIn = 4,
                dictSize = 4,
                numBits = 3,
                entry = "",
                result = [],
                i,
                w,
                bits, resb, maxpower, power,
                c,
                data = {
                    val: getNextValue(0),
                    position: resetValue,
                    index: 1
                };

            for (i = 0; i < 3; i += 1) {
                dictionary[i] = i;
            }

            bits = 0;
            maxpower = Math.pow(2, 2);
            power = 1;
            while (power != maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
            }

            switch (next = bits) {
            case 0:
                bits = 0;
                maxpower = Math.pow(2, 8);
                power = 1;
                while (power != maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position == 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                c = f(bits);
                break;
            case 1:
                bits = 0;
                maxpower = Math.pow(2, 16);
                power = 1;
                while (power != maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position == 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                c = f(bits);
                break;
            case 2:
                return "";
            }
            dictionary[3] = c;
            w = c;
            result.push(c);
            while (true) {
                if (data.index > length) {
                    return "";
                }

                bits = 0;
                maxpower = Math.pow(2, numBits);
                power = 1;
                while (power != maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position == 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }

                switch (c = bits) {
                case 0:
                    bits = 0;
                    maxpower = Math.pow(2, 8);
                    power = 1;
                    while (power != maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position == 0) {
                            data.position = resetValue;
                            data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }

                    dictionary[dictSize++] = f(bits);
                    c = dictSize - 1;
                    enlargeIn--;
                    break;
                case 1:
                    bits = 0;
                    maxpower = Math.pow(2, 16);
                    power = 1;
                    while (power != maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position == 0) {
                            data.position = resetValue;
                            data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }
                    dictionary[dictSize++] = f(bits);
                    c = dictSize - 1;
                    enlargeIn--;
                    break;
                case 2:
                    return result.join('');
                }

                if (enlargeIn == 0) {
                    enlargeIn = Math.pow(2, numBits);
                    numBits++;
                }

                if (dictionary[c]) {
                    entry = dictionary[c];
                } else {
                    if (c === dictSize) {
                        entry = w + w.charAt(0);
                    } else {
                        return null;
                    }
                }
                result.push(entry);

                // Add w+entry[0] to the dictionary.
                dictionary[dictSize++] = w + entry.charAt(0);
                enlargeIn--;

                w = entry;

                if (enlargeIn == 0) {
                    enlargeIn = Math.pow(2, numBits);
                    numBits++;
                }

            }
        }
    };
    return LZString;
});
// http://www.makeitgo.ws/articles/animationframe/
// http://paulirish.com/2011/requestanimationframe-for-smart-animating/
// http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating
// requestAnimationFrame polyfill by Erik Möller. fixes from Paul Irish and Tino Zijdel
bento.define('bento/lib/requestanimationframe', [], function () {
    'use strict';

    var lastTime = 0,
        vendors = ['ms', 'moz', 'webkit', 'o'];
    for (var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x] + 'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x] + 'CancelAnimationFrame'] || window[vendors[x] + 'CancelRequestAnimationFrame'];
    }

    if (!window.requestAnimationFrame)
        window.requestAnimationFrame = function (callback, element) {
            var currTime = new Date().getTime(),
                timeToCall = Math.max(0, 16 - (currTime - lastTime)),
                id = window.setTimeout(function () {
                    callback(currTime + timeToCall);
                }, timeToCall);
            lastTime = currTime + timeToCall;
            return id;
        };

    if (!window.cancelAnimationFrame)
        window.cancelAnimationFrame = function (id) {
            clearTimeout(id);
        };
    return window.requestAnimationFrame;
});
/**
 * Manager that loads and controls assets. Can be accessed through Bento.assets namespace.
 * Assets MUST be loaded through assetGroups (for now). An assetgroup is a json file that indicates which
 * assets to load, and where to find them.
 * <br>Exports: Constructor, can be accessed through Bento.assets namespace
 * @module bento/managers/asset
 * @moduleName AssetManager
 * @returns AssetManager
 */
bento.define('bento/managers/asset', [
    'bento/eventsystem',
    'bento/packedimage',
    'bento/utils',
    'audia',
    'lzstring'
], function (
    EventSystem,
    PackedImage,
    Utils,
    Audia,
    LZString
) {
    'use strict';
    return function (settings) {
        var useQueries = settings.useQueries; // placing queries avoids cached http requests
        var autoDisposeTextures = settings.autoDisposeTextures;
        var now = Date.now();
        var assetGroups = {};
        var loadedGroups = {};
        var path = '';
        var assets = {
            audio: {},
            json: {},
            images: {},
            binary: {},
            fonts: {},
            spritesheets: {},
            texturePacker: {},
            spine: {},

            // packed
            'packed-images': {},
            'packed-spritesheets': {},
            'packed-json': {}
        };
        var spineAssetLoader;
        var tempSpineImage;
        /**
         * (Down)Load asset types
         */
        var loadAudio = function (name, sources, callback) {
            var i, l;
            var failed = true;
            var lastSrc;
            var loadAudioFile = function (index, src) {
                var audio = new Audia();
                // get type by checking extension name
                var canPlay = audio.canPlayType('audio/' + src.slice(-3));

                if (src.indexOf('data:') === 0) {
                    // base64 data of audio
                    canPlay = true;
                }

                if (!!canPlay || window.ejecta) {
                    // success!
                    if (!manager.skipAudioCallback) {
                        audio.onload = function () {
                            callback(null, name, audio);
                        };
                    } else {
                        // callback immediately
                        window.setTimeout(function () {
                            callback(null, name, audio);
                        }, 0);
                    }
                    if (src.indexOf('http') === 0) {
                        audio.crossOrigin = 'Anonymous';
                    }
                    audio.src = src + (useQueries ? '?t=' + now : '');
                    failed = false;
                    return true;
                }
                if (!canPlay) {
                    lastSrc = src;
                }
                return false;
            };
            if (!Utils.isArray(sources)) {
                sources = [sources];
            }
            // try every type
            for (i = 0, l = sources.length; i < l; ++i) {
                if (loadAudioFile(i, sources[i])) {
                    // we only care about one of the audio types working
                    break;
                }
            }
            if (failed) {
                callback('This audio type is not supported:' + name + lastSrc);
            }
        };
        var loadJSON = function (name, source, callback, isCompressed) {
            var xhr;
            var parseJson = function (jsonText) {
                var jsonData;
                try {
                    // read header
                    if (jsonText[0] === 'L' && jsonText[1] === 'Z' && jsonText[2] === 'S') {
                        isCompressed = true;
                        // trim header
                        jsonText = jsonText.substring(3);
                    }

                    if (isCompressed) {
                        // decompress if needed
                        jsonData = JSON.parse(LZString.decompressFromBase64(jsonText));
                    } else {
                        jsonData = JSON.parse(jsonText);
                    }
                } catch (e) {
                    console.log('WARNING: Could not parse JSON ' + name + ' at ' + source + ': ' + e);
                    console.log('Trying to parse', jsonText);
                    jsonData = jsonText;
                }
                callback(null, name, jsonData);
            };

            // source is a base64 string -> parse immediately instead of doing the xhr request
            if (source.indexOf('data:application/json;base64,') === 0) {
                if (window.decodeB64) {
                    parseJson(window.decodeB64(source.replace('data:application/json;base64,', '')));
                } else {
                    parseJson(window.atob(source.replace('data:application/json;base64,', '')));
                }
                return;
            } else if (source.indexOf('LZS') === 0) {
                parseJson(source);
                return;
            }

            xhr = new window.XMLHttpRequest();
            if (xhr.overrideMimeType) {
                xhr.overrideMimeType('application/json');
            }

            xhr.open('GET', source + (useQueries ? '?t=' + now : ''), true);
            xhr.onerror = function () {
                callback('Error: loading JSON ' + source);
            };
            xhr.ontimeout = function () {
                callback('Timeout: loading JSON ' + source);
            };
            xhr.onreadystatechange = function () {
                var response;
                if (xhr.readyState === 4) {
                    if ((xhr.status === 304) || (xhr.status === 200) || ((xhr.status === 0) && xhr.responseText)) {
                        response = xhr.responseText;
                        parseJson(response);
                    } else {
                        callback('Error: State ' + xhr.readyState + ' ' + source);
                    }
                }
            };
            xhr.send(null);
        };
        var loadJsonCompressed = function (name, source, callback) {
            return loadJSON(name, source, callback, true);
        };
        var loadBinary = function (name, source, success, failure) {
            var xhr = new window.XMLHttpRequest();
            var arrayBuffer;
            var byteArray;
            var buffer;
            var i = 0;

            xhr.open('GET', source + (useQueries ? '?t=' + now : ''), true);
            xhr.onerror = function () {
                failure('ERROR: loading binary ' + source);
            };
            xhr.responseType = 'arraybuffer';
            xhr.onload = function (e) {
                var binary;
                arrayBuffer = xhr.response;
                if (arrayBuffer) {
                    byteArray = new Uint8Array(arrayBuffer);
                    buffer = [];
                    for (i; i < byteArray.byteLength; ++i) {
                        buffer[i] = String.fromCharCode(byteArray[i]);
                    }
                    // loadedAssets.binary[name] = buffer.join('');
                    binary = buffer.join('');
                    success(null, name, binary);
                }
            };
            xhr.send();
        };
        var loadImage = function (name, source, callback) {
            var img = new Image();
            img._dispose = img.dispose; // backup original if it exists
            img.dispose = function () {
                // cocoon
                if (img._dispose) {
                    img._dispose();
                }
                // pixi
                if (img.texture && img.texture.destroy) {
                    img.texture.destroy();
                }
            };

            // cocoon lazy load, might be useful some day?
            // img.cocoonLazyLoad = true;

            img.addEventListener('load', function () {
                callback(null, name, img);
            }, false);
            img.addEventListener('error', function (evt) {
                // TODO: Implement failure: should it retry to load the image?
                Utils.log('ERROR: loading image ' + source);
            }, false);

            if (source.indexOf('http') === 0) {
                img.crossOrigin = "Anonymous";
            }

            img.src = source + (useQueries ? '?t=' + now : '');
        };
        var loadTTF = function (name, source, callback) {
            // for every font to load we measure the width on a canvas
            var splitName = name;
            var canvas = document.createElement('canvas');
            var context = canvas.getContext('2d');
            var width = 0;
            var oldWidth;
            var intervalId;
            var checkCount = 0;
            var measure = function () {
                width = context.measureText('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890.,').width;
                return width;
            };
            var loadFont = function () {
                // append a style element with the font face
                // this method works with Canvas+
                var style = document.createElement('style');
                style.setAttribute("type", "text/css");
                style.innerHTML = "@font-face { font-family: '" + name +
                    "'; src: url('" + source + "');}";

                document.body.appendChild(style);

                // try setting it
                context.font = "normal 16px " + name;
            };
            // detect a loaded font by checking if the width changed
            var isLoaded = function () {
                return oldWidth !== measure();
            };

            // unlike other assets, the font name is not allowed to have slashes!
            if (name.indexOf("/") >= 0) {
                splitName = name.split("/");
                // swap name with last word
                name = splitName[splitName.length - 1];
            }

            loadFont();

            // measure for the first time
            oldWidth = measure();

            // check every 100ms
            intervalId = window.setInterval(function () {
                if (isLoaded()) {
                    // done!
                    window.clearInterval(intervalId);
                    if (callback) {
                        callback(null, name, name);
                    }
                } else if (checkCount >= 10) {
                    // give up after 1000ms
                    // possible scenarios:
                    // * a mistake was made, for example a typo in the path, and the font was never loaded
                    // * the font was already loaded (can happen in reloading in Cocoon devapp)
                    // either way we continue as if nothing happened, not loading the font shouldn't crash the game
                    window.clearInterval(intervalId);
                    console.log('Warning: font "' + name + '" timed out with loading.');
                    if (callback) {
                        callback(null, name, name);
                    }
                }
                checkCount += 1;
            }, 100);
        };
        var loadSpriteSheet = function (name, source, callback) {
            var spriteSheet = {
                image: null,
                animation: null
            };

            var checkForCompletion = function () {
                if (spriteSheet.image !== null && spriteSheet.animation !== null) {
                    callback(null, name, spriteSheet);
                }
            };
            var sourceJson;
            var sourcePng;

            // source can be an object with 2 base64 strings
            if (source.json) {
                sourceJson = source.json;
                sourcePng = source.png;
            } else {
                sourceJson = source + '.json';
                sourcePng = source + '.png';
            }

            loadJSON(name, sourceJson, function (err, name, json) {
                if (err) {
                    callback(err, name, null);
                    return;
                }
                spriteSheet.animation = json;
                checkForCompletion();
            });

            loadImage(name, sourcePng, function (err, name, img) {
                if (err) {
                    callback(err, name, null);
                    return;
                }
                spriteSheet.image = PackedImage(img);
                checkForCompletion();
            });
        };
        var loadPackedImage = function (name, source, callback) {
            // very similar to spritesheet: load an image and load a json
            var packedImage = {
                image: null,
                data: null
            };
            var checkForCompletion = function () {
                if (packedImage.image !== null && packedImage.data !== null) {
                    callback(null, name, packedImage);
                }
            };
            var sourceJson;
            var sourcePng;

            // source can be an object with 2 base64 strings
            if (source.json) {
                sourceJson = source.json;
                sourcePng = source.png;
            } else {
                sourceJson = source + '.json';
                sourcePng = source + '.png';
            }

            loadJSON(name, sourceJson, function (err, name, json) {
                if (err) {
                    callback(err, name, null);
                    return;
                }
                packedImage.data = json;
                checkForCompletion();
            });
            loadImage(name, sourcePng, function (err, name, img) {
                if (err) {
                    callback(err, name, null);
                    return;
                }
                packedImage.image = img;
                checkForCompletion();
            });
        };
        var loadSpriteSheetPack = function (name, source, callback) {
            var spriteSheet = {
                image: null,
                data: null
            };

            var checkForCompletion = function () {
                if (spriteSheet.image !== null && spriteSheet.data !== null) {
                    callback(null, name, spriteSheet);
                }
            };
            var sourceJson;
            var sourcePng;

            // source can be an object with 2 base64 strings
            if (source.json) {
                sourceJson = source.json;
                sourcePng = source.png;
            } else {
                sourceJson = source + '.json';
                sourcePng = source + '.png';
            }

            loadJSON(name, sourceJson, function (err, name, json) {
                if (err) {
                    callback(err, name, null);
                    return;
                }
                spriteSheet.data = json;
                checkForCompletion();
            });

            loadImage(name, sourcePng, function (err, name, img) {
                if (err) {
                    callback(err, name, null);
                    return;
                }
                spriteSheet.image = img;
                checkForCompletion();
            });
        };
        var loadSpine = function (name, source, callback) {
            var path = (function () {
                // remove the final part
                var paths = source.split('/');
                paths.splice(-1, 1);
                return paths.join('/') + '/';
            })();
            var spine = {
                skeleton: null,
                atlas: null,
                images: [], // {img: Image, path: ''}
                imageCount: 0, // only used to check if all images are loaded
                skinImages: {}, // imageName -> skinName
                path: path,
                pathJson: source + ".json", // need this when removing asset
                pathAtlas: source + ".atlas", // need this when removing asset
                dispose: function () {
                    var i, l;
                    for (i = 0, l = spine.images.length; i < l; ++i) {
                        spineAssetLoader.remove(spine.images[i].path);
                    }
                    spineAssetLoader.remove(spine.pathJson);
                    spineAssetLoader.remove(spine.pathAtlas);
                }
            };
            var checkForCompletion = function () {
                if (
                    spine.imageCount === spine.images.length &&
                    spine.skeleton !== null &&
                    spine.atlas !== null
                ) {
                    callback(null, name, spine);
                }
            };
            var onLoadSpineJson = function (path, data) {
                spine.skeleton = data;
                checkForCompletion();

                // next: load atlas
                spineAssetLoader.loadText(
                    source.replace("-pro", "").replace("-ess", "") + ".atlas",
                    function (path, dataAtlas) {
                        // it is in my belief that spine exports either the atlas or json wrong when skins are involved
                        // the atlas path becomes an relative path to the root as opposed to relative to images/
                        var skeletonJson = JSON.parse(data);
                        var prefix = skeletonJson.skeleton.images || '';
                        prefix = prefix.replace('./', '');
                        while (prefix && dataAtlas.indexOf(prefix) >= 0) {
                            dataAtlas = dataAtlas.replace(prefix, '');
                        }
                        onLoadSpineAtlas(path, dataAtlas);
                    },
                    function (path, err) {
                        callback(err, name, null);
                    }
                );
            };
            var onLoadSpineAtlas = function (path, data) {
                // parse the atlas just to check what images to load
                var textureAtlas = new window.spine.TextureAtlas(data, function (path) {
                    // return a fake texture
                    if (!tempSpineImage) {
                        tempSpineImage = new Image();
                    }
                    return new window.spine.FakeTexture(tempSpineImage);
                });
                var pages = textureAtlas.pages;
                var i, l;

                // update image count
                spine.imageCount = pages.length;

                // load all the images
                if (!manager.lazyLoadSpine) {
                    for (i = 0, l = pages.length; i < l; ++i) {
                        spineAssetLoader.loadTexture(
                            spine.path + pages[i].name,
                            onLoadSpineImage,
                            function (path, err) {
                                callback(err, name, null);
                            }
                        );
                    }
                } else {
                    // in case of lazy loading: Bento asset manager will not manage the spine images!
                    spine.imageCount = 0;

                    // we will now inspect the texture atlas and match skins with images
                    // which allows us to lazy load images per skin
                    // requirement: one image must match one skin! see this forum post http://esotericsoftware.com/forum/Separated-atlas-for-each-skin-9835?p=45504#p45504
                    linkSkinWithImage(textureAtlas);
                }

                spine.atlas = data;
                checkForCompletion();
            };
            var onLoadSpineImage = function (path, image) {
                spine.images.push({
                    img: image,
                    path: path
                });
                checkForCompletion();
            };
            var linkSkinWithImage = function (textureAtlas) {
                // In order for the lazy loading to work, we need to know 
                // what skin is related to which image. Spine will not do this out of the box
                // so we will have to parse the skeleton json and atlas manually and make
                // think link ourselves.
                var skeletonJson = JSON.parse(spine.skeleton);
                var skins = skeletonJson.skins;
                var findRegion = function (name) {
                    // searches region for a name and returns the page name
                    var i, l;
                    var region;
                    var regions = textureAtlas.regions;
                    for (i = 0, l = regions.length; i < l; ++i) {
                        region = regions[i];
                        if (region.name === name) {
                            return region.page.name;
                        }
                    }
                    return '';
                };
                Utils.forEach(skins, function (skinData, skinName) {
                    Utils.forEach(skinData, function (slotData, slotName, l, breakLoop) {
                        Utils.forEach(slotData, function (attachmentData, attachmentName) {
                            var actualAttachmentName = attachmentData.name;
                            // we link the name with a region in the atlas data
                            var pageName;

                            if (!actualAttachmentName) {
                                // attachment name does not exist, just assign to the first page??
                                pageName = textureAtlas.pages[0].name;
                            } else {
                                pageName = findRegion(actualAttachmentName);
                            }

                            // once found, we break the slots loop
                            if (pageName) {
                                breakLoop();
                                spine.skinImages[pageName] = skinName;
                            }
                        });
                    });
                });
            };

            // to load spine, you must include spine-canvas.js
            if (!window.spine) {
                console.error("ERROR: spine library not found!");
                callback("Loading spine failed.");
                return;
            }
            // note: we could in the future implement the asset loading with bento
            // but for convenience sake we simply use the spine asset manager for now
            if (!spineAssetLoader) {
                spineAssetLoader = new window.spine.canvas.AssetManager();
            }

            spineAssetLoader.loadText(
                spine.pathJson,
                onLoadSpineJson, // will load atlas here
                function (path, err) {
                    callback(err, name, null);
                }
            );
        };
        /**
         * Loads asset groups (json files containing names and asset paths to load)
         * If the assetGroup parameter is passed to Bento.setup, this function will be
         * called automatically by Bento.
         * This will not load the assets (merely the assetgroups). To load the assets,
         * you must call Bento.assets.load()
         * @function
         * @instance
         * @param {Object} jsonFiles - Name with json path
         * @param {Function} onReady - Callback when ready
         * @param {Function} onLoaded - Callback when json file is loaded
         * @name loadAssetGroups
         */
        var loadAssetGroups = function (jsonFiles, onReady, onLoaded) {
            var jsonName;
            var keyCount = Utils.getKeyLength(jsonFiles);
            var loaded = 0;
            var callback = function (err, name, json) {
                if (err) {
                    Utils.log(err);
                    return;
                }
                assetGroups[name] = json;
                loaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(loaded, keyCount, name, 'json');
                }
                if (keyCount === loaded && Utils.isDefined(onReady)) {
                    onReady(null, 'assetGroup');
                }
            };
            for (jsonName in jsonFiles) {
                if (jsonFiles.hasOwnProperty(jsonName)) {
                    loadJSON(jsonName, jsonFiles[jsonName], callback);
                }
            }
        };
        /**
         * Loads assets from asset group.
         * @function
         * @instance
         * @param {String} groupName - Name of asset group
         * @param {Function} onReady - Callback when ready
         * @param {Function} onLoaded - Callback when asset file is loaded
         * @param {Bool} skipPackedImages - do not initialize texture packed images
         * @name load
         */
        var load = function (groupName, onReady, onLoaded) {
            var group = assetGroups[groupName];
            var asset;
            var assetsLoaded = 0;
            var assetCount = 0;
            var toLoad = [];
            // assets to unpack
            var toUnpack = {
                'packed-images': {},
                'packed-spritesheets': {},
                'packed-json': {}
            };
            var packs = [];
            var postLoad = function () {
                var initPackedImagesLegacy = function () {
                    // old way of packed images
                    var frame, pack, i, l, image, json, name;
                    while (packs.length) {
                        pack = packs.pop();
                        image = getImageElement(pack);
                        json = getJson(pack);

                        if (!image || !json) {
                            // TODO: should have a cleaner method to check if packs are not loaded yet
                            // return the pack until the image/json is loaded
                            packs.push(pack);
                            return;
                        }

                        // parse json
                        for (i = 0, l = json.frames.length; i < l; ++i) {
                            name = json.frames[i].filename;
                            name = name.substring(0, name.length - 4);
                            frame = json.frames[i].frame;
                            assets.texturePacker[name] = new PackedImage(image, frame);
                        }
                    }
                };
                var initPackedImages = function () {
                    // expand into images
                    var packedImages = toUnpack['packed-images'];
                    Utils.forEach(packedImages, function (packData, name) {
                        var image = packData.image;
                        var data = packData.data;
                        Utils.forEach(data, function (textureData, i) {
                            // turn into image data
                            var assetName = textureData.assetName;
                            var frame = {
                                x: textureData.x,
                                y: textureData.y,
                                w: textureData.width,
                                h: textureData.height,
                            };
                            assets.texturePacker[assetName] = new PackedImage(image, frame);
                        });
                    });
                };
                var unpackJson = function () {
                    // unpack json into multiple jsons
                    var key;
                    var packedJson = toUnpack['packed-json'];
                    Utils.forEach(packedJson, function (group) {
                        Utils.forEach(group, function (json, key, l, breakLoop) {
                            assets.json[key] = json;
                        });
                    });
                };
                var unpackSpriteSheets = function () {
                    // expand into images
                    var packedImages = toUnpack['packed-spritesheets'];
                    Utils.forEach(packedImages, function (packData, name) {
                        var image = packData.image;
                        var data = packData.data;
                        Utils.forEach(data, function (textureData, i) {
                            // turn into image data
                            var assetName = textureData.assetName;
                            var frame = {
                                x: textureData.x,
                                y: textureData.y,
                                w: textureData.width,
                                h: textureData.height,
                            };
                            var spriteSheet = {
                                image: new PackedImage(image, frame),
                                animation: textureData.spriteSheet
                            };
                            assets.spritesheets[assetName] = spriteSheet;
                        });
                    });
                };
                // after everything has loaded, do some post processing
                initPackedImagesLegacy();
                initPackedImages();
                unpackJson();
                unpackSpriteSheets();
                // mark as loaded
                loadedGroups[groupName] = true;
                // callback
                if (Utils.isDefined(onReady)) {
                    onReady(null, groupName);
                }
            };
            var checkLoaded = function () {
                if (assetCount === 0 || (assetCount > 0 && assetsLoaded === assetCount)) {
                    postLoad();
                }
            };
            var onLoadImage = function (err, name, image) {
                if (err) {
                    Utils.log(err);
                    return;
                }
                assets.images[name] = image;
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'image');
                }
                checkLoaded();
            };
            // DEPRECATED
            var onLoadPack = function (err, name, json) {
                // TODO: fix texturepacker loading
                if (err) {
                    Utils.log(err);
                    return;
                }
                assets.json[name] = json;
                packs.push(name);
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'pack');
                }
                checkLoaded();
            };
            var onLoadJson = function (err, name, json) {
                if (err) {
                    Utils.log(err);
                    return;
                }
                assets.json[name] = json;
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'json');
                }
                checkLoaded();
            };
            var onLoadTTF = function (err, name, ttf) {
                if (err) {
                    Utils.log(err);
                    return;
                }
                assets.fonts[name] = ttf;
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'ttf');
                }
                checkLoaded();
            };
            var onLoadAudio = function (err, name, audio) {
                if (err) {
                    Utils.log(err);
                } else {
                    assets.audio[name] = audio;
                }
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'audio');
                }
                checkLoaded();
            };
            var onLoadSpriteSheet = function (err, name, spriteSheet) {
                if (err) {
                    Utils.log(err);
                } else {
                    assets.spritesheets[name] = spriteSheet;
                }
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'spriteSheet');
                }
                checkLoaded();
            };
            var onLoadSpine = function (err, name, spine) {
                if (err) {
                    Utils.log(err);
                } else {
                    assets.spine[name] = spine;
                }
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'spine');
                }
                checkLoaded();
            };
            // packs
            var onLoadImagePack = function (err, name, imagePack) {
                if (err) {
                    Utils.log(err);
                    return;
                }
                assets['packed-images'][name] = imagePack;
                toUnpack['packed-images'][name] = imagePack;
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'imagePack');
                }
                checkLoaded();
            };
            var onLoadJsonPack = function (err, name, json) {
                if (err) {
                    console.log(err);
                    return;
                }
                assets['packed-json'][name] = json;
                toUnpack['packed-json'][name] = json;
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'jsonPack');
                }
                checkLoaded();
            };
            var onLoadSpriteSheetPack = function (err, name, spriteSheetPack) {
                if (err) {
                    Utils.log(err);
                    return;
                }
                assets['packed-spritesheets'][name] = spriteSheetPack;
                toUnpack['packed-spritesheets'][name] = spriteSheetPack;
                assetsLoaded += 1;
                if (Utils.isDefined(onLoaded)) {
                    onLoaded(assetsLoaded, assetCount, name, 'spriteSheetPack');
                }
                checkLoaded();
            };

            var readyForLoading = function (fn, asset, path, callback) {
                toLoad.push({
                    fn: fn,
                    asset: asset,
                    path: path,
                    callback: callback
                });
            };
            var loadAllAssets = function () {
                var i = 0,
                    l;
                var data;
                for (i = 0, l = toLoad.length; i < l; ++i) {
                    data = toLoad[i];
                    data.fn(data.asset, data.path, data.callback);
                }
                if (toLoad.length === 0) {
                    checkLoaded();
                }
            };

            if (!Utils.isDefined(group)) {
                onReady('Could not find asset group ' + groupName);
                return;
            }
            // set path
            if (Utils.isDefined(group.path)) {
                path = group.path;
            }
            // count the number of assets first
            // get images
            if (Utils.isDefined(group.images)) {
                assetCount += Utils.getKeyLength(group.images);
                for (asset in group.images) {
                    if (!group.images.hasOwnProperty(asset)) {
                        continue;
                    }
                    readyForLoading(loadImage, asset, path === 'base64' ? group.images[asset] : path + 'images/' + group.images[asset], onLoadImage);
                }
            }
            // get packed images
            if (Utils.isDefined(group.texturePacker)) {
                assetCount += Utils.getKeyLength(group.texturePacker);
                for (asset in group.texturePacker) {
                    if (!group.texturePacker.hasOwnProperty(asset)) {
                        continue;
                    }
                    readyForLoading(loadJSON, asset, path === 'base64' ? group.texturePacker[asset] : path + 'json/' + group.texturePacker[asset], onLoadPack);
                }
            }
            // get audio
            if (Utils.isDefined(group.audio)) {
                assetCount += Utils.getKeyLength(group.audio);
                Utils.forEach(group.audio, function (asset, key, l, breakLoop) {
                    // concat path on array
                    var src = [];
                    // asset can be a single string or array of strings
                    if (!Utils.isArray(asset)) {
                        asset = [asset];
                    }
                    Utils.forEach(asset, function (audioSrc) {
                        src.push(path === 'base64' ? audioSrc : path + 'audio/' + audioSrc);
                    });

                    readyForLoading(loadAudio, key, src, onLoadAudio);
                });
            }
            // get json
            if (Utils.isDefined(group.json)) {
                assetCount += Utils.getKeyLength(group.json);
                for (asset in group.json) {
                    if (!group.json.hasOwnProperty(asset)) {
                        continue;
                    }
                    readyForLoading(loadJSON, asset, path === 'base64' ? group.json[asset] : path + 'json/' + group.json[asset], onLoadJson);
                }
            }
            // get fonts
            if (Utils.isDefined(group.fonts)) {
                assetCount += Utils.getKeyLength(group.fonts);
                for (asset in group.fonts) {
                    if (!group.fonts.hasOwnProperty(asset)) {
                        continue;
                    }
                    readyForLoading(loadTTF, asset, path === 'base64' ? group.fonts[asset] : path + 'fonts/' + group.fonts[asset], onLoadTTF);
                }
            }
            // get spritesheets
            if (Utils.isDefined(group.spritesheets)) {
                assetCount += Utils.getKeyLength(group.spritesheets);
                for (asset in group.spritesheets) {
                    if (!group.spritesheets.hasOwnProperty(asset)) {
                        continue;
                    }
                    readyForLoading(loadSpriteSheet, asset, path === 'base64' ? group.spritesheets[asset] : path + 'spritesheets/' + group.spritesheets[asset], onLoadSpriteSheet);
                }
            }
            // get spine
            if (Utils.isDefined(group.spine)) {
                assetCount += Utils.getKeyLength(group.spine);
                for (asset in group.spine) {
                    if (!group.spine.hasOwnProperty(asset)) {
                        continue;
                    }
                    readyForLoading(loadSpine, asset, path + 'spine/' + group.spine[asset], onLoadSpine);
                }
            }

            // packed assets
            if (Utils.isDefined(group['packed-images'])) {
                assetCount += Utils.getKeyLength(group['packed-images']);
                Utils.forEach(group['packed-images'], function (assetPath, assetName) {
                    readyForLoading(loadPackedImage, assetName, path === 'base64' ? assetPath : path + 'packed-images/' + assetPath, onLoadImagePack);
                });
            }
            // get (compressed) packed json
            if (Utils.isDefined(group['packed-json'])) {
                assetCount += Utils.getKeyLength(group['packed-json']);
                Utils.forEach(group['packed-json'], function (assetPath, assetName) {
                    readyForLoading(loadJSON, assetName, path === 'base64' ? assetPath : path + 'packed-json/' + assetPath, onLoadJsonPack);
                });
            }
            // get packed spritesheet
            if (Utils.isDefined(group['packed-spritesheets'])) {
                assetCount += Utils.getKeyLength(group['packed-spritesheets']);
                Utils.forEach(group['packed-spritesheets'], function (assetPath, assetName) {
                    readyForLoading(loadSpriteSheetPack, assetName, path === 'base64' ? assetPath : path + 'packed-spritesheets/' + assetPath, onLoadSpriteSheetPack);
                });
            }

            // load all assets
            loadAllAssets();

            return assetCount;
        };
        /**
         * Loads image from URL. The resulting asset can be accessed through Bento.assets.getImage().
         * @function
         * @instance
         * @param {String} name - Name of asset
         * @param {String} url - Url path (relative to your index.html)
         * @param {Function} callback - Callback function
         * @name loadImageFromUrl
         */
        var loadImageFromUrl = function (name, url, callback) {
            var onLoadImage = function (err, name, image) {
                if (err) {
                    Utils.log(err);
                    if (callback) {
                        callback(err);
                    }
                    return;
                }
                assets.images[name] = image;
                if (callback) {
                    callback(null, image);
                }
            };
            if (assets.images[name]) {
                // already exists
                if (callback) {
                    callback(null, assets.images[name]);
                }
                return;
            }
            loadImage(name, url, onLoadImage);
        };
        /**
         * Loads JSON from URL. The resulting asset can be accessed through Bento.assets.getJson().
         * @function
         * @instance
         * @param {String} name - Name of asset
         * @param {String} url - Url path (relative to your index.html)
         * @param {Function} callback - Callback function
         * @name loadJsonFromUrl
         */
        var loadJsonFromUrl = function (name, url, callback) {
            var onLoadJson = function (err, name, json) {
                if (err) {
                    Utils.log(err);
                    if (callback) {
                        callback(err);
                    }
                    return;
                }
                assets.json[name] = json;
                if (callback) {
                    callback(null, json);
                }
            };
            loadJSON(name, url, onLoadJson);
        };
        /**
         * Loads audio from URL. The resulting asset can be accessed through Bento.assets.getAudio().
         * @function
         * @instance
         * @param {String} name - Name of asset
         * @param {String} url - Url path (relative to your index.html)
         * @param {Function} callback - Callback function
         * @name loadAudioFromUrl
         */
        var loadAudioFromUrl = function (name, url, callback) {
            var onLoadAudio = function (err, name, audio) {
                if (err) {
                    Utils.log(err);
                    if (callback) {
                        callback(err);
                    }
                    return;
                }
                assets.audio[name] = audio;
                if (callback) {
                    callback(audio);
                }
            };
            loadAudio(name, url, onLoadAudio);
        };
        /**
         * Unloads assets
         * @function
         * @instance
         * @param {String} groupName - Name of asset group
         * @param {Boolean} dispose - Should use Canvas+ dispose
         * @name unload
         */
        var unload = function (groupName, dispose) {
            // find all assets in this group
            var assetGroup = assetGroups[groupName];
            
            dispose = Utils.getDefault(dispose, true);

            if (!assetGroup) {
                Utils.log('ERROR: asset group ' + groupName + ' does not exist');
                return;
            }

            Utils.forEach(assetGroup, function (group, type) {
                if (typeof group !== "object") {
                    return;
                }
                Utils.forEach(group, function (assetPath, name) {
                    // NOTE: from this point on there are a lot of manual checks etc.
                    // would be nicer to make unify the logic...

                    // find the corresponding asset from the assets object
                    var assetTypeGroup = assets[type] || {};
                    var asset = assetTypeGroup[name];
                    var removePackedImage = function (packedImages) {
                        // find what it unpacked to
                        var image = packedImages.image;
                        var data = packedImages.data;
                        Utils.forEach(data, function (textureData, i) {
                            // find out the asset name
                            var assetName = textureData.assetName;
                            var textureAsset = assets.texturePacker[assetName];
                            // delete if this asset still exists
                            if (textureAsset) {
                                delete assets.texturePacker[assetName];
                            }
                        });
                        // dispose if possible
                        if (dispose && image.dispose) {
                            image.dispose();
                        }
                        if (dispose && image.image && image.image.dispose) {
                            image.image.dispose();
                        }
                    };
                    var removePackedSpriteSheet = function (packedSpriteSheets) {
                        // find what it unpacked to
                        var image = packedSpriteSheets.image;
                        var data = packedSpriteSheets.data;
                        Utils.forEach(data, function (textureData, i) {
                            // find out the asset name
                            var assetName = textureData.assetName;
                            var spriteSheet = assets.spritesheets[assetName];
                            // delete if this asset still exists
                            if (spriteSheet) {
                                delete assets.spritesheets[assetName];
                            }
                        });
                        // dispose if possible
                        if (dispose && image.dispose) {
                            image.dispose();
                        }
                        if (dispose && image.image && image.image.dispose) {
                            image.image.dispose();
                        }
                    };
                    var removePackedJson = function (packedJson) {
                        // find what it unpacked to
                        Utils.forEach(packedJson, function (json, key, l, breakLoop) {
                            delete assets.json[key];
                        });
                    };

                    if (asset) {
                        // remove reference to it
                        assetTypeGroup[name] = undefined;
                        // delete could be bad for performance(?)
                        delete assetTypeGroup[name];

                        if (type === 'images') {
                            // also remove corresponding texturepacker
                            if (assets.texturePacker[name]) {
                                assets.texturePacker[name] = undefined;
                                delete assets.texturePacker[name];
                            }
                        } else if (type === 'packed-images') {
                            removePackedImage(asset);
                        } else if (type === 'packed-spritesheets') {
                            removePackedSpriteSheet(asset);
                        } else if (type === 'packed-json') {
                            removePackedJson(asset);
                        }

                        // Canvas+ only: dispose if possible
                        // https://blog.ludei.com/techniques-to-optimize-memory-use-in-ludeis-canvas-environment/
                        if (dispose) {
                            // image
                            if (asset.dispose) {
                                asset.dispose();
                            }
                            // spritesheet or spine
                            else if (asset.image && asset.image.dispose) {
                                asset.image.dispose();
                            } else if (asset.image && asset.image.image && asset.image.image.dispose) {
                                asset.image.image.dispose();
                            }
                            // audia
                            else if (asset._audioNode && asset._audioNode.dispose) {
                                asset._audioNode.dispose();
                            }
                        }
                    }
                });
            });
            // mark as unloaded
            loadedGroups[groupName] = false;
        };
        /**
         * Returns a previously loaded image
         * @function
         * @instance
         * @param {String} name - Name of image
         * @returns {PackedImage} Image
         * @name getImage
         */
        var getImage = function (name) {
            // NOTE: getImage always returns a PackedImage
            // if the loaded image has not been initialized as PackedImage yet,
            // getImage will do that now and caches the PackedImage in assets.texturePacker
            var image, packedImage = assets.texturePacker[name];
            if (!packedImage) {
                image = getImageElement(name);
                if (!image) {
                    Utils.log("ERROR: Image " + name + " could not be found");
                    return null;
                }
                packedImage = PackedImage(image);
                assets.texturePacker[name] = packedImage;
            }
            return packedImage;
        };
        /**
         * Returns a previously loaded image element
         * @function
         * @instance
         * @param {String} name - Name of image
         * @returns {HTMLImage} Html Image element
         * @name getImageElement
         */
        var getImageElement = function (name) {
            var asset = assets.images[name];
            if (!Utils.isDefined(asset)) {
                Utils.log("ERROR: ImageElement " + name + " could not be found");
            }
            return asset;
        };
        /**
         * Returns a previously loaded json object
         * @function
         * @instance
         * @param {String} name - Name of json file
         * @returns {Object} Json object
         * @name getJson
         */
        var getJson = function (name) {
            var asset = assets.json[name];
            if (!Utils.isDefined(asset)) {
                Utils.log("ERROR: JSON " + name + " could not be found");
            }
            return asset;
        };
        /**
         * Returns a previously loaded audio element (currently by howler)
         * @function
         * @instance
         * @param {String} name - Name of image
         * @returns {Audia} Audia object
         * @name getAudio
         */
        var getAudio = function (name) {
            var asset = assets.audio[name];
            if (!Utils.isDefined(asset)) {
                Utils.log("ERROR: Audio " + name + " could not be found");
            }
            return asset;
        };
        /**
         * Returns a previously loaded spriteSheet element
         * @function
         * @instance
         * @param {String} name - Name of spriteSheet
         * @returns {Object} spriteSheet object
         * @name getSpriteSheet
         */
        var getSpriteSheet = function (name) {
            var asset = assets.spritesheets[name];
            if (!Utils.isDefined(asset)) {
                Utils.log("ERROR: Sprite sheet " + name + " could not be found");
            }
            return asset;
        };
        /**
         * Returns a previously loaded Spine object
         * @function
         * @instance
         * @param {String} name - Name of Spine object
         * @returns {Object} Spine object
         * @name getSpine
         */
        var getSpine = function (name) {
            var asset = assets.spine[name];
            if (!Utils.isDefined(asset)) {
                Utils.log("ERROR: Spine object " + name + " could not be found");
            }
            return asset;
        };
        var getSpineLoader = function (name) {
            return spineAssetLoader;
        };
        /**
         * Returns all assets
         * @function
         * @instance
         * @param {String} name - Name of image
         * @returns {Object} assets - Object with reference to all loaded assets
         * @name getAssets
         */
        var getAssets = function () {
            return assets;
        };
        /**
         * Returns asset group
         * @function
         * @instance
         * @returns {Object} assetGroups - reference to loaded JSON file
         * @name getAssetGroups
         */
        var getAssetGroups = function () {
            return assetGroups;
        };
        /**
         * Reloads all previously loaded assets
         * @function
         * @instance
         * @param {Function} callback - called when all assets are loaded
         * @name reload
         */
        var reload = function (callback) {
            var group;
            var loaded = 0;
            var groupsToLoad = [];
            var loadGroups = function () {
                var i, l;
                for (i = 0, l = groupsToLoad.length; i < l; ++i) {
                    load(groupsToLoad[i], end, function (current, total, name) {});
                }
            };
            var end = function () {
                loaded += 1;

                if (loaded === groupsToLoad.length && callback) {
                    callback();
                }
            };
            // refresh query
            now = Date.now();

            // refresh cache in textures
            assets.texturePacker = {};

            // collect groups
            for (group in assetGroups) {
                if (!assetGroups.hasOwnProperty(group)) {
                    continue;
                }
                if (!loadedGroups[group]) {
                    // havent loaded this group yet
                    continue;
                }
                groupsToLoad.push(group);
            }

            // load them
            loadGroups();
        };
        /**
         * Attempts to load ./assets.json and interpret it as assetgroups
         * @function
         * @instance
         * @param {Function} onRead - Called with an error string or null if successful
         * @name loadAssetsJson
         */
        var loadAssetsJson = function (onReady) {
            loadJSON('assets.json', 'assets.json', function (error, name, assetsJson) {
                var isLoading = false;
                var groupsToLoad = {};
                if (error) {
                    onReady(error);
                    return;
                }
                // check the contents of json
                Utils.forEach(assetsJson, function (group, groupName, l, breakLoop) {
                    if (Utils.isString(group)) {
                        // assume assets.json consists of strings to load json files with
                        isLoading = true;
                        groupsToLoad[groupName] = group;
                    } else {
                        // the asset group is present
                        assetGroups[groupName] = group;
                    }
                });

                if (isLoading) {
                    // load jsons
                    loadAssetGroups(groupsToLoad, onReady);
                } else {
                    // done
                    onReady(null, 'assetsJson');
                }
            });
        };
        // undocumented feature: assets.json may be inlined as window.assetJson
        var loadInlineAssetsJson = function () {
            if (window.assetsJson) {
                if (Utils.isString(window.assetsJson)) {
                    // decompress first
                    window.assetsJson = JSON.parse(LZString.decompressFromBase64(window.assetsJson));
                }
                Utils.forEach(window.assetsJson, function (group, groupName) {
                    // the asset group is present
                    assetGroups[groupName] = group;
                });
            }
        };
        /**
         * Loads all assets
         * @function
         * @instance
         * @param {Object} settings
         * @param {Array} settings.exceptions - array of strings, which asset groups not to load
         * @param {Function} settings.onComplete - called when all assets are loaded
         * @param {Function} settings.onLoad - called on every asset loaded
         * @name reload
         */
        var loadAllAssets = function (settings) {
            var exceptions = settings.exceptions || [];
            var onReady = settings.onReady || settings.onComplete || function (err, name) {};
            var onLoaded = settings.onLoaded || settings.onLoad || function (count, total, name, type) {};
            var group;
            var groupName;
            var groupCount = 0;
            var assetCount = 0;
            var groupsLoaded = 0;
            var current = 0;
            // check if all groups loaded
            var end = function (err) {
                if (err) {
                    Utils.log(err);
                    return;
                }
                groupsLoaded += 1;
                if (groupsLoaded === groupCount && onReady) {
                    onReady(null);
                }
            };
            // called on every asset
            var loadAsset = function (c, a, name, type) {
                current += 1;
                if (onLoaded) {
                    onLoaded(current, assetCount, name, type);
                }
            };
            // count groups before any loading
            for (groupName in assetGroups) {
                if (!assetGroups.hasOwnProperty(groupName)) {
                    continue;
                }
                if (exceptions.indexOf(groupName) >= 0) {
                    continue;
                }
                groupCount += 1;
            }

            // check every assetgroup and load its assets
            for (groupName in assetGroups) {
                if (!assetGroups.hasOwnProperty(groupName)) {
                    continue;
                }
                if (exceptions.indexOf(groupName) >= 0) {
                    continue;
                }
                group = assetGroups[groupName];
                assetCount += load(groupName, end, loadAsset);
            }

            // nothing to load
            if (groupCount === 0 && onReady) {
                onReady();
            }
        };
        /**
         * Check if asset is loaded
         * @function
         * @instance
         * @param {String} name - name of asset
         * @param {String} [type] - type of asset (images, json, fonts, spritesheets etc). If omitted, all types will be searched
         * @return Boolean
         * @name hasAsset
         */
        var hasAsset = function (name, type) {
            var didFind = false;
            // fail when type doesnt exist
            if (type) {
                if (!assets[type]) {
                    // typo? (image vs images)
                    if (!assets[type + 's']) {
                        console.error('Asset type ' + type + " doesn't exist.");
                        return false;
                    } else {
                        console.log('WARNING: type should be ' + type + 's, not ' + type);
                        type = type + 's';
                    }
                }
                // check if asset exist
                if (assets[type][name]) {
                    return true;
                } else {
                    if (type === 'images') {
                        // images is a special case regarding packed textures
                        return hasAsset(name, 'texturePacker');
                    }
                }
            } else {
                // check all types
                Utils.forEach(assets, function (assetTypeGroup, assetType, l, breakLoop) {
                    if (assetTypeGroup[name]) {
                        didFind = true;
                        breakLoop();
                    }
                });
            }

            return didFind;
        };
        var manager = {
            lazyLoadSpine: false,
            skipAudioCallback: false,
            reload: reload,
            loadAllAssets: loadAllAssets,
            loadAssetGroups: loadAssetGroups,
            loadAssetsJson: loadAssetsJson,
            loadInlineAssetsJson: loadInlineAssetsJson,
            load: load,
            loadJson: loadJSON,
            loadImageFromUrl: loadImageFromUrl,
            loadJsonFromUrl: loadJsonFromUrl,
            loadAudioFromUrl: loadAudioFromUrl,
            unload: unload,
            getImage: getImage,
            getImageElement: getImageElement,
            getJson: getJson,
            getAudio: getAudio,
            getSpriteSheet: getSpriteSheet,
            getAssets: getAssets,
            getAssetGroups: getAssetGroups,
            hasAsset: hasAsset,
            getSpine: getSpine,
            getSpineLoader: getSpineLoader,
            forceHtml5Audio: function () {
                Audia = Audia.getHtmlAudia();
            }
        };

        // implement dispose for spine canvas texture(?)
        /*if (window.spine && window.spine.canvas && window.spine.canvas.CanvasTexture) {
            window.spine.canvas.CanvasTexture.prototype.dispose = function () {
                if (this._image && this._image.dispose) {
                    this._image.dispose();
                }
            };
        }*/

        if (autoDisposeTextures) {
            // destroy webgl textures on every screen hide
            EventSystem.on('screenHidden', function () {
                Utils.forEach(assets.images, function (image) {
                    if (image && image.texture && image.texture.destroy) {
                        image.texture.destroy();
                        image.texture = null;
                    }
                });
            });
        }

        return manager;
    };
});
/**
 * Audio manager to play sounds and music. The audio uses WebAudio API when possible, though it's mostly based on HTML5 Audio for
 * CocoonJS compatibility. To make a distinction between sound effects and music, you must prefix the audio
 * asset names with sfx_ and bgm_ respectively.
 * <br>Exports: Constructor, can be accessed through Bento.audio namespace.
 * @module bento/managers/audio
 * @moduleName AudioManager
 * @returns AudioManager
 */
bento.define('bento/managers/audio', [
    'bento/utils'
], function (Utils) {
    return function (bento) {
        var volume = 1,
            mutedSound = false,
            mutedMusic = false,
            preventSounds = false,
            isPlayingMusic = false,
            howler,
            musicLoop = false,
            lastMusicPlayed = '',
            currentMusicId = 0,
            saveMuteSound,
            saveMuteMusic,
            assetManager = bento.assets,
            canvasElement = bento.getCanvas(),
            onVisibilityChanged = function (hidden) {
                if (obj.ignorePageVisibility) {
                    return;
                }
                if (hidden) {
                    // save audio preferences and mute
                    saveMuteSound = mutedSound;
                    saveMuteMusic = mutedMusic;
                    obj.muteMusic(true);
                    obj.muteSound(true);
                } else {
                    // reload audio preferences and replay music if necessary
                    mutedSound = saveMuteSound;
                    mutedMusic = saveMuteMusic;
                    if (lastMusicPlayed) {
                        obj.playMusic(lastMusicPlayed, musicLoop);
                    }
                }
            },
            obj = {
                ignorePageVisibility: false,
                /**
                 * Sets the volume (0 = minimum, 1 = maximum)
                 * @name setVolume
                 * @instance
                 * @function
                 * @param {Number} value - the volume
                 * @param {String} name - name of the sound to change volume
                 */
                setVolume: function (value, name) {
                    var audio = assetManager.getAudio(name);
                    if (!audio) {
                        return;
                    }
                    audio.volume = value;
                },
                /**
                 * Gets the volume (0 = minimum, 1 = maximum)
                 * @name getVolume
                 * @instance
                 * @function
                 * @param {String} name - name of the sound
                 */
                getVolume: function (name) {
                    var audio = assetManager.getAudio(name);
                    if (!audio) {
                        Utils.log('ERROR: Could not find audio file');
                        return 0;
                    }
                    return audio.volume;
                },
                /**
                 * Plays a sound effect
                 * @name playSound
                 * @instance
                 * @function
                 * @param {String} name - name of the audio asset
                 * @param {Boolean} [loop] - should the audio loop (defaults to false)
                 * @param {Function} [onEnd] - callback when the audio ends
                 * @param {Boolean} [stopSound] - stops the sound if true
                 */
                playSound: function (name, loop, onEnd, stopSound) {
                    var audio = assetManager.getAudio(name);
                    var slashIndex = name.lastIndexOf('/');
                    if (!audio) {
                        Utils.log('ERROR: Could not find audio file');
                        return;
                    }

                    if (name.substr(slashIndex + 1, 4) !== 'sfx_') {
                        Utils.log("Warning: file names of sound effects should start with 'sfx_'");
                    }

                    if (!mutedSound && !preventSounds) {
                        if (stopSound)
                            obj.stopSound(name);
                        if (Utils.isDefined(loop)) {
                            audio.loop = loop;
                        }
                        if (Utils.isDefined(onEnd)) {
                            audio.onended = onEnd;
                        }
                        audio.play();
                    }
                },
                /**
                 * Stops a specific sound effect
                 * @name stopSound
                 * @instance
                 * @function
                 */
                stopSound: function (name) {
                    var i, l, node;
                    var audio = assetManager.getAudio(name);
                    if (!audio) {
                        Utils.log('ERROR: Could not find audio file');
                        return;
                    }
                    audio.stop();
                },
                /**
                 * Plays a music
                 * @name playMusic
                 * @instance
                 * @function
                 * @param {String} name - name of the audio asset
                 * @param {Boolean} [loop] - should the audio loop (defaults to true)
                 * @param {Function} [onEnd] - callback when the audio ends
                 * @param {Boolean} [stopAllMusic] - stops all music if true
                 */
                playMusic: function (name, loop, onEnd, stopAllMusic) {
                    var audio;
                    var slashIndex = name.lastIndexOf('/');

                    if (stopAllMusic) {
                        obj.stopAllMusic();
                    }

                    if (name.substr(slashIndex + 1, 4) !== 'bgm_') {
                        Utils.log("Warning: file names of music tracks should start with 'bgm_'");
                    }

                    lastMusicPlayed = name;
                    if (Utils.isDefined(loop)) {
                        musicLoop = loop;
                    } else {
                        musicLoop = true;
                    }
                    // set end event
                    if (!mutedMusic && lastMusicPlayed !== '') {
                        audio = assetManager.getAudio(name);
                        if (!audio) {
                            Utils.log('ERROR: Could not find audio file');
                            return;
                        }
                        if (onEnd) {
                            audio.onended = onEnd;
                        }
                        audio.loop = musicLoop;
                        audio.play();
                        isPlayingMusic = true;
                    }
                },
                /**
                 * Stops a specific music
                 * @name stopMusic
                 * @param {String} name - name of the audio asset
                 * @instance
                 * @function
                 */
                stopMusic: function (name) {
                    var i, l, node;
                    assetManager.getAudio(name).stop();
                    isPlayingMusic = false;
                },
                /**
                 * Mute or unmute all sound
                 * @name muteSound
                 * @instance
                 * @function
                 * @param {Boolean} mute - whether to mute or not
                 */
                muteSound: function (mute) {
                    mutedSound = mute;
                    if (mutedSound) {
                        // we stop all sounds because setting volume is not supported on all devices
                        this.stopAllSound();
                    }
                },
                /**
                 * Mute or unmute all music
                 * @instance
                 * @name muteMusic
                 * @function
                 * @param {Boolean} mute - whether to mute or not
                 * @param {Boolean} continueMusic - whether the music continues
                 */
                muteMusic: function (mute, continueMusic) {
                    var last = lastMusicPlayed;
                    mutedMusic = mute;

                    if (!Utils.isDefined(continueMusic)) {
                        continueMusic = false;
                    }
                    if (mutedMusic) {
                        obj.stopAllMusic();
                        lastMusicPlayed = last;
                    } else if (continueMusic && lastMusicPlayed !== '') {
                        obj.playMusic(lastMusicPlayed, musicLoop);
                    }
                },
                /**
                 * Stop all sound effects currently playing
                 * @instance
                 * @name stopAllSound
                 * @function
                 */
                stopAllSound: function () {
                    var sound,
                        sounds = assetManager.getAssets().audio;
                    for (sound in sounds) {
                        if (sounds.hasOwnProperty(sound) && sound.indexOf('sfx_') >= 0) {
                            sounds[sound].stop();
                        }
                    }
                },
                /**
                 * Stop all music currently playing
                 * @instance
                 * @name stopAllMusic
                 * @function
                 */
                stopAllMusic: function () {
                    var sound,
                        sounds = assetManager.getAssets().audio;
                    for (sound in sounds) {
                        if (sounds.hasOwnProperty(sound) && sound.indexOf('bgm_') >= 0) {
                            sounds[sound].stop(sound === lastMusicPlayed ? currentMusicId : void(0));
                        }
                    }
                    lastMusicPlayed = '';
                    isPlayingMusic = false;
                },
                /**
                 * Prevents any sound from playing without interrupting current sounds
                 * @instance
                 * @name preventSounds
                 * @function
                 */
                preventSounds: function (bool) {
                    preventSounds = bool;
                },
                /**
                 * Returns true if any music is playing
                 * @instance
                 * @name isPlayingMusic
                 * @param {String} [name] - Check whether this particular music is playing
                 * @function
                 */
                isPlayingMusic: function (name) {
                    if (name) {
                        return lastMusicPlayed === name;
                    }
                    return isPlayingMusic;
                }
            };
        // https://developer.mozilla.org/en-US/docs/Web/Guide/User_experience/Using_the_Page_Visibility_API
        if ('hidden' in document) {
            document.addEventListener("visibilitychange", function () {
                onVisibilityChanged(document.hidden);
            }, false);
        } else if ('mozHidden' in document) {
            document.addEventListener("mozvisibilitychange", function () {
                onVisibilityChanged(document.mozHidden);
            }, false);
        } else if ('webkitHidden' in document) {
            document.addEventListener("webkitvisibilitychange", function () {
                onVisibilityChanged(document.webkitHidden);
            }, false);
        } else if ('msHidden' in document) {
            document.addEventListener("msvisibilitychange", function () {
                onVisibilityChanged(document.msHidden);
            }, false);
        } else if ('onpagehide' in window) {
            window.addEventListener('pagehide', function () {
                onVisibilityChanged(true);
            }, false);
            window.addEventListener('pageshow', function () {
                onVisibilityChanged(false);
            }, false);
        } else if ('onblur' in document) {
            window.addEventListener('blur', function () {
                onVisibilityChanged(true);
            }, false);
            window.addEventListener('focus', function () {
                onVisibilityChanged(false);
            }, false);
        } else if ('onfocusout' in document) {
            window.addEventListener('focusout', function () {
                onVisibilityChanged(true);
            }, false);
            window.addEventListener('focusin', function () {
                onVisibilityChanged(false);
            }, false);
        }
        return obj;
    };
});
/**
 * Manager that tracks mouse/touch and keyboard input. Useful for manual input managing.
 * <br>Exports: Constructor, can be accessed through Bento.input namespace.
 * @module bento/managers/input
 * @moduleName InputManager
 * @param {Object} gameData - gameData
 * @param {Vector2} gameData.canvasScale - Reference to the current canvas scale.
 * @param {HtmlCanvas} gameData.canvas - Reference to the canvas element.
 * @param {Rectangle} gameData.viewport - Reference to viewport.
 * @param {Object} settings - settings passed from Bento.setup
 * @param {Boolean} [settings.preventContextMenu] - Prevents right click menu
 * @param {Boolean} [settings.globalMouseUp] - Catch mouseup events outside canvas (only useful for desktop)
 * @returns InputManager
 */
bento.define('bento/managers/input', [
    'bento/utils',
    'bento/math/vector2',
    'bento/eventsystem'
], function (Utils, Vector2, EventSystem) {
    'use strict';
    var startPositions = {};
    return function (gameData, settings) {
        var isPaused = false,
            isListening = false,
            canvas,
            canvasScale,
            viewport,
            pointers = [],
            keyStates = {},
            offsetLeft = 0,
            offsetTop = 0,
            offsetLocal = new Vector2(0, 0),
            gamepad,
            gamepads,
            gamepadButtonsPressed = [],
            gamepadButtonStates = {},
            remote,
            remoteButtonsPressed = [],
            remoteButtonStates = {},
            pointerDown = function (evt) {
                pointers.push({
                    id: evt.id,
                    position: evt.position,
                    eventType: evt.eventType,
                    localPosition: evt.localPosition,
                    worldPosition: evt.worldPosition
                });
                EventSystem.fire('pointerDown', evt);
            },
            pointerMove = function (evt) {
                EventSystem.fire('pointerMove', evt);
                updatePointer(evt);
            },
            pointerUp = function (evt) {
                EventSystem.fire('pointerUp', evt);
                removePointer(evt);
            },
            touchStart = function (evt) {
                var id, i, l;
                evt.preventDefault();
                for (i = 0, l = evt.changedTouches.length; i < l; ++i) {
                    addTouchPosition(evt, i, 'start');
                    pointerDown(evt);
                }
            },
            touchMove = function (evt) {
                var id, i, l;
                evt.preventDefault();
                for (i = 0, l = evt.changedTouches.length; i < l; ++i) {
                    addTouchPosition(evt, i, 'move');
                    pointerMove(evt);
                }
            },
            touchEnd = function (evt) {
                var id, i, l;
                evt.preventDefault();
                for (i = 0, l = evt.changedTouches.length; i < l; ++i) {
                    addTouchPosition(evt, i, 'end');
                    pointerUp(evt);
                }
            },
            mouseDown = function (evt) {
                // evt.preventDefault();
                addMousePosition(evt, 'start');
                pointerDown(evt);
            },
            mouseMove = function (evt) {
                // evt.preventDefault();
                addMousePosition(evt, 'move');
                pointerMove(evt);
            },
            mouseUp = function (evt) {
                // evt.preventDefault();
                addMousePosition(evt, 'end');
                pointerUp(evt);
            },
            addTouchPosition = function (evt, n, type) {
                var touch = evt.changedTouches[n];
                var hasBoundingClientRect = (evt.target && evt.target.getBoundingClientRect);
                var x, y;
                if (hasBoundingClientRect) {
                    // https://stackoverflow.com/a/42111623 --> more accurate?
                    var rect = evt.target.getBoundingClientRect();
                    x = (touch.pageX - rect.left) / canvasScale.x + offsetLocal.x;
                    y = (touch.pageY - rect.top) / canvasScale.y + offsetLocal.y;
                } else {
                    x = (touch.pageX - offsetLeft) / canvasScale.x + offsetLocal.x;
                    y = (touch.pageY - offsetTop) / canvasScale.y + offsetLocal.y;
                }
                var startPos = {};

                evt.preventDefault();
                evt.id = 0;
                evt.eventType = 'touch';
                touch.position = new Vector2(x, y);
                touch.worldPosition = touch.position.clone();
                touch.worldPosition.x += viewport.x;
                touch.worldPosition.y += viewport.y;
                touch.localPosition = touch.position.clone();
                // add 'normal' position
                evt.position = touch.position.clone();
                evt.worldPosition = touch.worldPosition.clone();
                evt.localPosition = touch.localPosition.clone();
                // id
                evt.id = touch.identifier + 1;
                // diff position
                if (type === 'start') {
                    startPos.startPosition = touch.position.clone();
                    startPos.startWorldPosition = touch.worldPosition.clone();
                    startPos.startLocalPosition = touch.localPosition.clone();
                    // save startPos
                    startPositions[evt.id] = startPos;
                }
                if (type === 'end') {
                    // load startPos
                    startPos = startPositions[evt.id];
                    if (startPos && startPos.startPosition) {
                        touch.diffPosition = touch.position.subtract(startPos.startPosition);
                        touch.diffWorldPosition = touch.worldPosition.subtract(startPos.startWorldPosition);
                        touch.diffLocalPosition = touch.localPosition.subtract(startPos.startLocalPosition);
                        evt.diffPosition = touch.diffPosition.clone();
                        evt.diffWorldPosition = touch.diffWorldPosition.clone();
                        evt.diffLocalPosition = touch.diffLocalPosition.clone();
                        delete startPositions[evt.id];
                    } else {
                        Utils.log("ERROR: touch startPosition was not defined");
                    }
                }

            },
            addMousePosition = function (evt, type) {
                var hasBoundingClientRect = (evt.target && evt.target.getBoundingClientRect);
                var x, y;
                if (hasBoundingClientRect) {
                    // https://stackoverflow.com/a/42111623 --> more accurate?
                    var rect = evt.target.getBoundingClientRect();
                    x = (evt.clientX - rect.left) / canvasScale.x + offsetLocal.x;
                    y = (evt.clientY - rect.top) / canvasScale.y + offsetLocal.y;
                } else {
                    x = (evt.pageX - offsetLeft) / canvasScale.x + offsetLocal.x;
                    y = (evt.pageY - offsetTop) / canvasScale.y + offsetLocal.y;
                }
                var startPos = {};
                var n = -1;
                evt.id = 0;
                evt.eventType = 'mouse';
                evt.position = new Vector2(x, y);
                evt.worldPosition = evt.position.clone();
                evt.worldPosition.x += viewport.x;
                evt.worldPosition.y += viewport.y;
                evt.localPosition = evt.position.clone();
                // diff position
                if (type === 'start') {
                    startPos.startPosition = evt.position.clone();
                    startPos.startWorldPosition = evt.worldPosition.clone();
                    startPos.startLocalPosition = evt.localPosition.clone();
                    // save startPos
                    startPositions[n] = startPos;
                }
                if (type === 'end') {
                    // load startPos
                    startPos = startPositions[n];
                    evt.diffPosition = evt.position.substract(startPos.startPosition);
                    evt.diffWorldPosition = evt.worldPosition.substract(startPos.startWorldPosition);
                    evt.diffLocalPosition = evt.localPosition.substract(startPos.startLocalPosition);
                }
                // give it an id that doesn't clash with touch id
                evt.id = -1;
            },
            updatePointer = function (evt) {
                var i = 0,
                    l;
                for (i = 0, l = pointers.length; i < l; ++i) {
                    if (pointers[i].id === evt.id) {
                        pointers[i].position = evt.position;
                        pointers[i].worldPosition = evt.worldPosition;
                        pointers[i].localPosition = evt.position;
                        return;
                    }
                }
            },
            removePointer = function (evt) {
                var i = 0,
                    l;
                for (i = 0, l = pointers.length; i < l; ++i) {
                    if (pointers[i].id === evt.id) {
                        pointers.splice(i, 1);
                        return;
                    }
                }
            },
            initTouch = function () {
                if (window.ejecta) {
                    canvas.addEventListener('tvtouchstart', tvTouchStart);
                    canvas.addEventListener('tvtouchmove', tvTouchMove);
                    canvas.addEventListener('tvtouchend', tvTouchEnd);
                }
                canvas.addEventListener('touchstart', touchStart);
                canvas.addEventListener('touchmove', touchMove);
                canvas.addEventListener('touchend', touchEnd);
                if (settings.globalMouseUp) {
                    // TODO: add correction for position
                    window.addEventListener('mouseup', mouseUp);
                } else {
                    canvas.addEventListener('mouseup', mouseUp);
                }
                canvas.addEventListener('mousedown', mouseDown);
                canvas.addEventListener('mousemove', mouseMove);
                isListening = true;

                if (!Utils.isCocoonJs()) {
                    canvas.addEventListener('touchstart', function (evt) {
                        if (evt && evt.preventDefault) {
                            evt.preventDefault();
                        }
                        if (evt && evt.stopPropagation) {
                            evt.stopPropagation();
                        }
                        return false;
                    });
                    canvas.addEventListener('touchmove', function (evt) {
                        if (evt && evt.preventDefault) {
                            evt.preventDefault();
                        }
                        if (evt && evt.stopPropagation) {
                            evt.stopPropagation();
                        }
                        return false;
                    });
                }

                // touchcancel can be used when system interveness with the game
                canvas.addEventListener('touchcancel', function (evt) {
                    EventSystem.fire('touchcancel', evt);
                });
            },
            initKeyboard = function () {
                var element = gameData.canvas || window,
                    refocus = function (evt) {
                        if (element.focus) {
                            element.focus();
                        }
                    };
                // fix for iframes
                element.tabIndex = 0;
                if (element.focus) {
                    element.focus();
                }
                element.addEventListener('keydown', keyDown, false);
                element.addEventListener('keyup', keyUp, false);
                // refocus
                element.addEventListener('mousedown', refocus, false);

            },
            keyDown = function (evt) {
                var i, l, names;
                evt.preventDefault();
                EventSystem.fire('keyDown', evt);
                // get names
                names = Utils.keyboardMapping[evt.keyCode];
                // catch unknown keys
                if (!names) {
                    Utils.log("ERROR: Key with keyCode " + evt.keyCode + " is undefined.");
                    return;
                }
                for (i = 0, l = names.length; i < l; ++i) {
                    keyStates[names[i]] = true;
                    EventSystem.fire('buttonDown', names[i]);
                    EventSystem.fire('buttonDown-' + names[i]);
                }
            },
            keyUp = function (evt) {
                var i, l, names;
                evt.preventDefault();
                EventSystem.fire('keyUp', evt);
                // get names
                names = Utils.keyboardMapping[evt.keyCode];
                // catch unknown keys
                if (!names) {
                    Utils.log("ERROR: Key with keyCode " + evt.keyCode + " is undefined.");
                    return;
                }
                for (i = 0, l = names.length; i < l; ++i) {
                    keyStates[names[i]] = false;
                    EventSystem.fire('buttonUp', names[i]);
                    EventSystem.fire('buttonUp-' + names[i]);
                }
            },
            destroy = function () {
                // remove all event listeners
            },
            /**
             * Changes the offsets after resizing or screen re-orientation.
             */
            updateCanvas = function () {
                var screenSize = Utils.getScreenSize();
                if (Utils.isCocoonJs()) {
                    // assumes full screen
                    canvasScale.x = screenSize.width / viewport.width;
                    canvasScale.y = screenSize.height / viewport.height;
                } else {
                    // use offsetWidth and offsetHeight to determine visual size
                    canvasScale.x = canvas.offsetWidth / viewport.width;
                    canvasScale.y = canvas.offsetHeight / viewport.height;
                    // get the topleft position
                    offsetLeft = canvas.offsetLeft;
                    offsetTop = canvas.offsetTop;
                }
            },
            initMouseClicks = function () {
                if (!canvas || !canvas.addEventListener) {
                    return;
                }
                canvas.addEventListener('contextmenu', function (e) {
                    EventSystem.fire('mouseDown-right');
                    // prevent context menu
                    if (settings.preventContextMenu) {
                        e.preventDefault();
                    }
                }, false);
                canvas.addEventListener('click', function (e) {
                    if (e.which === 1) {
                        EventSystem.fire('mouseDown-left');
                        e.preventDefault();
                    } else if (e.which === 2) {
                        EventSystem.fire('mouseDown-middle');
                        e.preventDefault();
                    }
                }, false);
            },
            /**
             * Adds event listeners for connecting/disconnecting a gamepad
             */
            initGamepad = function () {
                window.addEventListener('gamepadconnected', gamepadConnected);
                window.addEventListener('gamepaddisconnected', gamepadDisconnected);
            },
            /**
             * Fired when the browser detects that a gamepad has been connected or the first time a button/axis of the gamepad is used.
             * Adds a pre-update loop check for gamepads and gamepad input
             * @param {GamepadEvent} evt
             */
            gamepadConnected = function (evt) {
                // check for button input before the regular update
                EventSystem.on('preUpdate', checkGamepad);

                console.log('Gamepad connected:', evt.gamepad);
            },
            /**
             * Fired when the browser detects that a gamepad has been disconnected.
             * Removes the reference to the gamepad
             * @param {GamepadEvent} evt
             */
            gamepadDisconnected = function (evt) {
                gamepad = undefined;

                // stop checking for button input
                EventSystem.off('preUpdate', checkGamepad);
            },
            /**
             * Gets a list of all gamepads and checks if any buttons are pressed.
             */
            checkGamepad = function () {
                var i = 0,
                    len = 0;

                // get gamepad every frame because Chrome doesn't store a reference to the gamepad's state
                gamepads = navigator.getGamepads ? navigator.getGamepads() : (navigator.webkitGetGamepads ? navigator.webkitGetGamepads() : []);
                for (i = 0, len = gamepads.length; i < len; ++i) {
                    if (gamepads[i]) {
                        gamepad = gamepads[i];
                    }
                }

                if (!gamepad)
                    return;

                // uses an array to check against the state of the buttons from the previous frame
                for (i = 0, len = gamepad.buttons.length; i < len; ++i) {
                    if (gamepad.buttons[i].pressed !== gamepadButtonsPressed[i]) {
                        if (gamepad.buttons[i].pressed) {
                            gamepadButtonDown(i);
                        } else {
                            gamepadButtonUp(i);
                        }
                    }
                }
            },
            gamepadButtonDown = function (id) {
                var i = 0,
                    names = Utils.gamepadMapping[id],
                    len = 0;

                // confusing name is used to keep the terminology similar to keyDown/keyUp
                EventSystem.fire('gamepadKeyDown', id);
                // save value in array
                gamepadButtonsPressed[id] = true;

                for (i = 0, len = names.length; i < len; ++i) {
                    gamepadButtonStates[names[i]] = true;
                    EventSystem.fire('gamepadButtonDown', names[i]);
                    EventSystem.fire('gamepadButtonDown-' + names[i]);
                }
            },
            gamepadButtonUp = function (id) {
                var i = 0,
                    names = Utils.gamepadMapping[id],
                    len = 0;

                // confusing name is used to keep the terminology similar to keyDown/keyUp
                EventSystem.fire('gamepadKeyUp', id);
                // save value in array
                gamepadButtonsPressed[id] = false;

                for (i = 0, len = names.length; i < len; ++i) {
                    gamepadButtonStates[names[i]] = false;
                    EventSystem.fire('gamepadButtonUp', names[i]);
                }
            },
            /**
             * Adds a check for input from the apple remote before every update. Only if on tvOS.
             *
             * Ejecta (at least in version 2.0) doesn't have event handlers for button input, so
             * continually checking for input is the only way for now.
             */
            initRemote = function () {
                var i = 0,
                    l,
                    tvOSGamepads;

                if (window.ejecta) {
                    // get all connected gamepads
                    tvOSGamepads = navigator.getGamepads();
                    // find apple remote gamepad
                    for (i = 0, l = tvOSGamepads.length; i < l; ++i)
                        if (tvOSGamepads[i] && tvOSGamepads[i].profile === 'microGamepad')
                            remote = tvOSGamepads[i];

                    for (i = 0, l = remote.buttons.length; i < l; ++i)
                        remoteButtonsPressed.push(remote.buttons[i].pressed);

                    // check for button input before the regular update
                    EventSystem.on('preUpdate', checkRemote);
                }
            },
            /**
             * Checks if a remote button has been pressed. Runs before every frame, if added.
             */
            checkRemote = function () {
                var i = 0,
                    len = 0;

                // uses an array to check against the state of the buttons from the previous frame
                for (i = 0, len = remote.buttons.length; i < len; ++i) {
                    if (remote.buttons[i].pressed !== remoteButtonsPressed[i]) {
                        if (remote.buttons[i].pressed) {
                            remoteButtonDown(i);
                        } else {
                            remoteButtonUp(i);
                        }
                    }
                }
            },
            remoteButtonDown = function (id) {
                var i = 0,
                    l,
                    names = Utils.remoteMapping[id];
                // save value in array
                remoteButtonsPressed[id] = true;

                for (i = 0, l = names.length; i < l; ++i)
                    remoteButtonStates[names[i]] = true;
            },
            remoteButtonUp = function (id) {
                var i = 0,
                    l,
                    names = Utils.remoteMapping[id];
                // save value in array
                remoteButtonsPressed[id] = false;

                for (i = 0, l = names.length; i < l; ++i)
                    remoteButtonStates[names[i]] = false;
            },
            tvPointerDown = function (evt) {
                pointers.push({
                    id: evt.id,
                    position: evt.position,
                    eventType: evt.eventType,
                    localPosition: evt.localPosition,
                    worldPosition: evt.worldPosition
                });
                EventSystem.fire('tvPointerDown', evt);
            },
            tvPointerMove = function (evt) {
                EventSystem.fire('tvPointerMove', evt);
                updatePointer(evt);
            },
            tvPointerUp = function (evt) {
                EventSystem.fire('tvPointerUp', evt);
                removePointer(evt);
            },
            tvTouchStart = function (evt) {
                var id, i, l;
                evt.preventDefault();
                for (i = 0, l = evt.changedTouches.length; i < l; ++i) {
                    addTvTouchPosition(evt, i, 'start');
                    tvPointerDown(evt);
                }
            },
            tvTouchMove = function (evt) {
                var id, i, l;
                evt.preventDefault();
                for (i = 0, l = evt.changedTouches.length; i < l; ++i) {
                    addTvTouchPosition(evt, i, 'move');
                    tvPointerMove(evt);
                }
            },
            tvTouchEnd = function (evt) {
                var id, i, l;
                evt.preventDefault();
                for (i = 0, l = evt.changedTouches.length; i < l; ++i) {
                    addTvTouchPosition(evt, i, 'end');
                    tvPointerUp(evt);
                }
            },
            addTvTouchPosition = function (evt, n, type) {
                var touch = evt.changedTouches[n],
                    x = (touch.pageX - offsetLeft) / canvasScale.x + offsetLocal.x,
                    y = (touch.pageY - offsetTop) / canvasScale.y + offsetLocal.y,
                    startPos = {};

                evt.preventDefault();
                evt.id = 0;
                evt.eventType = 'tvtouch';
                touch.position = new Vector2(x, y);
                touch.worldPosition = touch.position.clone();
                touch.worldPosition.x += viewport.x;
                touch.worldPosition.y += viewport.y;
                touch.localPosition = touch.position.clone();
                // add 'normal' position
                evt.position = touch.position.clone();
                evt.worldPosition = touch.worldPosition.clone();
                evt.localPosition = touch.localPosition.clone();
                // id
                evt.id = touch.identifier + 1;
                // diff position
                if (type === 'start') {
                    startPos.startPosition = touch.position.clone();
                    startPos.startWorldPosition = touch.worldPosition.clone();
                    startPos.startLocalPosition = touch.localPosition.clone();
                    // save startPos
                    startPositions[evt.id] = startPos;
                }
                if (type === 'end') {
                    // load startPos
                    startPos = startPositions[evt.id];
                    if (startPos && startPos.startPosition) {
                        touch.diffPosition = touch.position.substract(startPos.startPosition);
                        touch.diffWorldPosition = touch.worldPosition.substract(startPos.startWorldPosition);
                        touch.diffLocalPosition = touch.localPosition.substract(startPos.startLocalPosition);
                        evt.diffPosition = touch.diffPosition.clone();
                        evt.diffWorldPosition = touch.diffWorldPosition.clone();
                        evt.diffLocalPosition = touch.diffLocalPosition.clone();
                        delete startPositions[evt.id];
                    } else {
                        Utils.log("ERROR: touch startPosition was not defined");
                    }
                }
            };

        if (!gameData) {
            throw 'Supply a gameData object';
        }
        // canvasScale is needed to take css scaling into account
        canvasScale = gameData.canvasScale;
        canvas = gameData.canvas;
        viewport = gameData.viewport;

        // note: it's a bit tricky with order of event listeners, make sure resizing is done first
        // otherwise updateCanvas needs to be called manually afterwards
        if (canvas) {
            updateCanvas();
        }

        // touch device
        initTouch();
        // keyboard
        initKeyboard();
        // init clicks
        initMouseClicks();
        // apple remote (only on tvOS)
        initRemote();
        // start listening for gamepads
        initGamepad();

        return {
            /**
             * Returns all current pointers down
             * @function
             * @instance
             * @returns {Array} pointers - Array with pointer positions
             * @name getPointers
             */
            getPointers: function () {
                return pointers;
            },
            /**
             * Removes all current pointers down
             * @function
             * @instance
             * @name resetPointers
             */
            resetPointers: function () {
                pointers.length = 0;
            },
            /**
             * Checks if a keyboard key is down
             * @function
             * @instance
             * @param {String} name - name of the key
             * @returns {Boolean} Returns true if the provided key is down.
             * @name isKeyDown
             */
            isKeyDown: function (name) {
                return keyStates[name] || false;
            },
            /**
             * Checks if any keyboard key is pressed
             * @function
             * @instance
             * @returns {Boolean} Returns true if any provided key is down.
             * @name isAnyKeyDown
             */
            isAnyKeyDown: function () {
                var state;

                for (state in keyStates)
                    if (keyStates[state])
                        return true;

                return false;
            },
            /**
             * Is the gamepad connected?
             * @function
             * @instance
             * @returns {Boolean} Returns true if gamepad is connected, false otherwise.
             * @name isGamepadButtonDown
             */
            isGamepadConnected: function () {
                if (gamepad)
                    return true;
                else
                    return false;
            },
            /**
             * Checks if a gamepad button is down
             * @function
             * @instance
             * @param {String} name - name of the button
             * @returns {Boolean} Returns true if the provided button is down.
             * @name isGamepadButtonDown
             */
            isGamepadButtonDown: function (name) {
                return gamepadButtonStates[name] || false;
            },
            /**
             * Checks if any gamepad button is pressed
             * @function
             * @instance
             * @returns {Boolean} Returns true if any button is down.
             * @name isAnyGamepadButtonDown
             */
            isAnyGamepadButtonDown: function () {
                var state;

                for (state in gamepadButtonStates)
                    if (gamepadButtonStates[state])
                        return true;

                return false;
            },
            /**
             * Returns the current float values of the x and y axes of left thumbstick
             * @function
             * @instance
             * @returns {Vector2} Values range from (-1, -1) in the top left to (1, 1) in the bottom right.
             * @name getGamepadAxesLeft
             */
            getGamepadAxesLeft: function () {
                return new Vector2(gamepad.axes[0], gamepad.axes[1]);
            },
            /**
             * Returns the current float values of the x and y axes of right thumbstick
             * @function
             * @instance
             * @returns {Vector2} Values range from (-1, -1) in the top left to (1, 1) in the bottom right.
             * @name getGamepadAxesRight
             */
            getGamepadAxesRight: function () {
                return new Vector2(gamepad.axes[2], gamepad.axes[3]);
            },
            /**
             * Checks if a remote button is down
             * @function
             * @instance
             * @param {String} name - name of the button
             * @returns {Boolean} Returns true if the provided button is down.
             * @name isRemoteButtonDown
             */
            isRemoteButtonDown: function (name) {
                return remoteButtonStates[name] || false;
            },
            /**
             * Defines if pressing 'menu' button will go back to Apple TV home screen
             * @function
             * @instance
             * @param {Boolean} Set to false if you want to assign custom behaviour for the 'menu' button
             * @name setRemoteExitOnMenuPress
             */
            setRemoteExitOnMenuPress: function (bool) {
                remote.exitOnMenuPress = bool;
            },
            /**
             * Returns the current float values of the x and y axes of the touch area
             * @function
             * @instance
             * @returns {Vector2} Values range from (-1, -1) in the top left to (1, 1) in the bottom right.
             * @name getRemoteAxes
             */
            getRemoteAxes: function () {
                return new Vector2(remote.axes[0], remote.axes[1]);
            },
            /**
             * Stop all pointer input
             * @function
             * @instance
             * @name stop
             */
            stop: function () {
                if (!isListening) {
                    return;
                }
                if (window.ejecta) {
                    canvas.removeEventListener('tvtouchstart', tvTouchStart);
                    canvas.removeEventListener('tvtouchmove', tvTouchMove);
                    canvas.removeEventListener('tvtouchend', tvTouchEnd);
                }
                canvas.removeEventListener('touchstart', touchStart);
                canvas.removeEventListener('touchmove', touchMove);
                canvas.removeEventListener('touchend', touchEnd);
                canvas.removeEventListener('mousedown', mouseDown);
                canvas.removeEventListener('mousemove', mouseMove);
                if (settings.globalMouseUp) {
                    window.removeEventListener('mouseup', mouseUp);
                } else {
                    canvas.removeEventListener('mouseup', mouseUp);
                }

                isListening = false;
            },
            /**
             * Resumes all pointer input
             * @function
             * @instance
             * @name resume
             */
            resume: function () {
                if (isListening) {
                    return;
                }
                if (window.ejecta) {
                    canvas.addEventListener('tvtouchstart', tvTouchStart);
                    canvas.addEventListener('tvtouchmove', tvTouchMove);
                    canvas.addEventListener('tvtouchend', tvTouchEnd);
                }
                canvas.addEventListener('touchstart', touchStart);
                canvas.addEventListener('touchmove', touchMove);
                canvas.addEventListener('touchend', touchEnd);
                canvas.addEventListener('mousedown', mouseDown);
                canvas.addEventListener('mousemove', mouseMove);
                if (settings.globalMouseUp) {
                    window.addEventListener('mouseup', mouseUp);
                } else {
                    canvas.addEventListener('mouseup', mouseUp);
                }

                isListening = true;
            },
            /**
             * Changes the offsets after resizing or screen re-orientation.
             * @function
             * @instance
             * @name updateCanvas
             */
            updateCanvas: updateCanvas,
            /**
             * Adds an offset to all pointer input
             * Note that this is in local space
             * @function
             * @instance
             * @param {Vector2} offset - Offset as Vector2
             * @name setOffset
             */
            setOffset: function (offset) {
                offsetLocal = offset;
            }
        };
    };
});
/**
 * Manager that controls mainloop and all objects. Attach entities to the object manager
 * to add them to the game. The object manager loops through every object's update and
 * draw functions. The settings object passed here is passed through Bento.setup().
 * <br>Exports: Constructor, can be accessed through Bento.objects namespace.
 * @module bento/managers/object
 * @moduleName ObjectManager
 * @param {Function} getGameData - Function that returns gameData object
 * @param {Object} settings - Settings object
 * @param {Object} settings.defaultSort - Use javascript default sorting with Array.sort (not recommended)
 * @param {Object} settings.useDeltaT - Use delta time (note: untested)
 * @returns ObjectManager
 */
bento.define('bento/managers/object', [
    'bento/utils',
    'bento/eventsystem'
], function (Utils, EventSystem) {
    'use strict';
    return function (getGameData, settings) {
        var objects = [];
        var lastTime = new Date().getTime();
        var cumulativeTime = 0;
        var minimumFps = 30;
        var lastFrameTime = new Date().getTime();
        var quickAccess = {};
        var isRunning = false;
        var sortMode = settings.sortMode || 0;
        var useDeltaT = settings.useDeltaT || false;
        var autoThrottle = settings.autoThrottle || false;
        var ms60fps = 1000 / 60;
        var isPaused = 0;
        var isStopped = false;
        var sortDefault = function () {
            // default array sorting method (unstable)
            objects.sort(function (a, b) {
                return a.z - b.z;
            });
        };
        var sortStable = function () {
            // default method for sorting: stable sort
            Utils.stableSort.inplace(objects, function (a, b) {
                return a.z - b.z;
            });
        };
        var sort = sortStable;
        var cleanObjects = function () {
            var i;
            // loop objects array from end to start and remove null elements
            for (i = objects.length - 1; i >= 0; --i) {
                if (objects[i] === null) {
                    objects.splice(i, 1);
                }
            }
        };
        var mainLoop = function (time) {
            var object,
                i,
                currentTime = new Date().getTime(),
                deltaT = currentTime - lastTime,
                data = getGameData();

            if (!isRunning) {
                return;
            }

            lastTime = currentTime;
            cumulativeTime += deltaT;
            data = getGameData();
            data.deltaT = deltaT;
            if (useDeltaT) {
                cumulativeTime = ms60fps;
                if (autoThrottle) {
                    module.throttle = Math.min(deltaT / ms60fps, 3); // doesn't go higher than 3x speed (20fps)
                }
            } else {
                // fixed time will not report the real delta time, 
                // assumes time goes by with 16.667 ms every frame
                data.deltaT = ms60fps;
            }
            while (cumulativeTime >= ms60fps) {
                cumulativeTime -= ms60fps;
                if (cumulativeTime > 1000 / minimumFps) {
                    // deplete cumulative time
                    while (cumulativeTime >= ms60fps) {
                        cumulativeTime -= ms60fps;
                    }
                }
                if (settings.useDeltaT) {
                    cumulativeTime = 0;
                }
                update(data);
            }
            cleanObjects();
            if (sortMode === Utils.SortMode.ALWAYS) {
                sort();
            }
            draw(data);

            lastFrameTime = time;

            window.requestAnimationFrame(mainLoop);
        };
        var currentObject; // the current object being processed in the main loop
        var update = function (data) {
            var object,
                i;

            data = data || getGameData();

            module.timer += data.speed;
            module.ticker += 1;

            EventSystem.fire('preUpdate', data);
            for (i = 0; i < objects.length; ++i) {
                object = objects[i];
                if (!object) {
                    continue;
                }
                currentObject = object;
                if (object.update && (object.updateWhenPaused >= isPaused)) {
                    object.update(data);
                }
                // update its rootIndex
                if (object.rootIndex !== undefined) {
                    object.rootIndex = i;
                }
            }
            EventSystem.fire('postUpdate', data);
        };
        var draw = function (data) {
            var object,
                i, l;
            data = data || getGameData();

            EventSystem.fire('preDraw', data);
            data.renderer.begin();
            EventSystem.fire('preDrawLoop', data);
            for (i = 0, l = objects.length; i < l; ++i) {
                object = objects[i];
                if (!object) {
                    continue;
                }
                currentObject = object;
                if (object.draw) {
                    object.draw(data);
                }
            }
            EventSystem.fire('postDrawLoop', data);
            data.renderer.flush();
            EventSystem.fire('postDraw', data);
        };
        var attach = function (object) {
            var i, l,
                family,
                data = getGameData();

            if (!object) {
                Utils.log("ERROR: trying to attach " + object);
                return;
            }

            if (!object.name) {
                console.warn("WARNING: object has no name", object);
            }

            if (object.isAdded || object.parent) {
                Utils.log("ERROR: Entity " + object.name + " was already added.");
                return;
            }

            object.z = object.z || 0;
            object.updateWhenPaused = object.updateWhenPaused || 0;
            objects.push(object);
            object.isAdded = true;
            if (object.init) {
                object.init();
            }
            // add object to access pools
            if (object.family) {
                family = object.family;
                for (i = 0, l = family.length; i < l; ++i) {
                    addObjectToFamily(object, family[i]);
                }
            }

            if (object.start) {
                object.start(data);
            }
            if (object.attached) {
                object.attached(data);
            }
            if (sortMode === Utils.SortMode.SORT_ON_ADD) {
                sort();
            }
        };
        var remove = function (object) {
            var i, l,
                index,
                family,
                data = getGameData();
            if (!object) {
                return;
            }
            // remove from access pools
            if (object.family) {
                family = object.family;
                for (i = 0, l = family.length; i < l; ++i) {
                    removeObjectFromFamily(object, family[i]);
                }
            }
            // remove from object list
            index = objects.indexOf(object);
            if (index >= 0) {
                objects[index] = null;
                if (object.destroy) {
                    object.destroy(data);
                }
                if (object.removed) {
                    object.removed(data);
                }
                object.isAdded = false;
            }
        };
        var addObjectToFamily = function (object, family) {
            if (objects.indexOf(object) === -1) {
                return;
            }

            if (!quickAccess[family]) {
                quickAccess[family] = [];
            }
            if (quickAccess[family].indexOf(object) === -1) {
                quickAccess[family].push(object);
            }
        };
        var removeObjectFromFamily = function (object, family) {
            var pool = quickAccess[family];

            if (objects.indexOf(object) === -1) {
                return;
            }

            if (pool) {
                Utils.removeFromArray(pool, object);
            }
        };
        var module = {
            /**
             * Global timer (affected by gamespeed)
             * @instance
             * @name timer
             */
            timer: 0,
            /**
             * Global ticker (increments every frame)
             * @instance
             * @name timer
             */
            ticker: 0,
            /**
             * Adds entity/object to the game. The object doesn't have to be an Entity. As long as the object
             * has the functions update and draw, they will be called during the loop.
             * @function
             * @instance
             * @param {Object} object - Any object, preferably an Entity
             * @name attach
             */
            attach: attach,
            add: attach,
            /**
             * Removes entity/object
             * @function
             * @instance
             * @param {Object} object - Reference to the object to be removed
             * @name remove
             */
            remove: remove,
            /**
             * Removes all entities/objects except ones that have the property "global"
             * @function
             * @instance
             * @param {Boolean} removeGlobal - Also remove global objects
             * @name removeAll
             */
            removeAll: function (removeGlobal) {
                var i, l,
                    object;
                for (i = 0, l = objects.length; i < l; ++i) {
                    object = objects[i];
                    if (!object) {
                        continue;
                    }
                    if (!object.global || removeGlobal) {
                        remove(object);
                    }
                }
                cleanObjects();
            },
            /**
             * Add or remove objects to a family
             */
            addObjectToFamily: addObjectToFamily,
            removeObjectFromFamily: removeObjectFromFamily,
            /**
             * Returns the first object it can find with this name. Safer to use with a callback.
             * The callback is called immediately if the object is found (it's not asynchronous).
             * @function
             * @instance
             * @param {String} objectName - Name of the object
             * @param {Function} [callback] - Called if the object is found
             * @returns {Object} null if not found
             * @name get
             */
            get: function (objectName, callback) {
                // retrieves the first object it finds by its name
                var i, l,
                    object;

                for (i = 0, l = objects.length; i < l; ++i) {
                    object = objects[i];
                    if (!object) {
                        continue;
                    }
                    if (!object.name) {
                        continue;
                    }
                    if (object.name === objectName) {
                        if (callback) {
                            callback(object);
                        }
                        return object;
                    }
                }
                return null;
            },
            /**
             * Returns an array of objects with a certain name
             * @function
             * @instance
             * @param {String} objectName - Name of the object
             * @param {Function} [callback] - Called with the object array
             * @returns {Array} An array of objects, empty if no objects found
             * @name getByName
             */
            getByName: function (objectName, callback) {
                var i, l,
                    object,
                    array = [];

                for (i = 0, l = objects.length; i < l; ++i) {
                    object = objects[i];
                    if (!object) {
                        continue;
                    }
                    if (!object.name) {
                        continue;
                    }
                    if (object.name === objectName) {
                        array.push(object);
                    }
                }
                if (callback && array.length) {
                    callback(array);
                }
                return array;
            },
            /**
             * Returns an array of objects by family name. Entities are added to pools
             * of each family you indicate in the Entity.family array the moment you call
             * Bento.objects.attach() and are automatically removed with Bento.objects.remove().
             * This allows quick access of a group of similar entities. Families are cached so you
             * may get a reference to the array of objects even if it's not filled yet.
             * @function
             * @instance
             * @param {String} familyName - Name of the family
             * @param {Function} [callback] - Called with the object array
             * @returns {Array} An array of objects, empty if no objects found
             * @name getByFamily
             */
            getByFamily: function (type, callback) {
                var array = quickAccess[type];
                if (!array) {
                    // initialize it
                    array = [];
                    quickAccess[type] = array;
                    // Utils.log('Warning: family called ' + type + ' does not exist', true);
                }
                if (callback && array.length) {
                    callback(array);
                }
                return array;
            },
            /**
             * Stops the mainloop on the next tick
             * @function
             * @instance
             * @name stop
             */
            stop: function () {
                isRunning = false;
            },
            /**
             * Starts the mainloop
             * @function
             * @instance
             * @name run
             */
            run: function (force) {
                if (!isRunning || force) {
                    isRunning = true;
                    mainLoop();
                }
            },
            /**
             * Returns the number of objects
             * @function
             * @instance
             * @returns {Number} The number of objects
             * @name count
             */
            count: function () {
                return objects.length;
            },
            /**
             * Stops calling update on every object. Note that draw is still
             * being called. Objects with the property updateWhenPaused
             * will still be updated.
             * @function
             * @instance
             * @param {Number} level - Level of pause state, defaults to 1
             * @name pause
             */
            pause: function (level) {
                isPaused = level;
                if (Utils.isUndefined(level)) {
                    isPaused = 1;
                }
            },
            /**
             * Cancels the pause and resume updating objects. (Sets pause level to 0)
             * @function
             * @instance
             * @name resume
             */
            resume: function () {
                isPaused = 0;
            },
            /**
             * Returns pause level. If an object is passed to the function
             * it checks if that object should be paused or not
             * @function
             * @instance
             * @param {Object} [object] - Object to check if it's paused
             * @name isPaused
             */
            isPaused: function (obj) {
                if (Utils.isDefined(obj)) {
                    return obj.updateWhenPaused < isPaused;
                }
                return isPaused;
            },
            /**
             * Forces objects to be drawn (Don't call this unless you need it)
             * @function
             * @instance
             * @param {GameData} [data] - Data object (see Bento.getGameData)
             * @name draw
             */
            draw: function (data) {
                draw(data);
            },
            /**
             * Sets the sorting mode. Use the Utils.SortMode enum as input:<br>
             * Utils.SortMode.ALWAYS - sort on every update tick<br>
             * Utils.SortMode.NEVER - don't sort at all<br>
             * Utils.SortMode.SORT_ON_ADD - sorts only when an object is attached<br>
             * @function
             * @instance
             * @param {Utils.SortMode} mode - Sorting mode
             * @name setSortMode
             */
            setSortMode: function (mode) {
                sortMode = mode;
            },
            /**
             * Calls the update function. Be careful when using this in another
             * update loop, as it will result in an endless loop.
             * @function
             * @instance
             * @param {GameData} [data] - Data object (see Bento.getGameData)
             * @name update
             */
            update: function (data) {
                update(data);
            },
            /**
             * Retrieves array of all objects.
             * @function
             * @instance
             * @name getObjects
             */
            getObjects: function () {
                return objects;
            },
            // useful for debugging, may be removed later so leaving this undocumented
            getCurrentObject: function () {
                return currentObject;
            },
            throttle: 1
        };

        // swap sort method with default sorting method
        if (settings.defaultSort) {
            sort = sortDefault;
        }

        return module;
    };
});
/**
 * Manager that controls presistent variables. A wrapper for localStorage. Use Bento.saveState.save() to
 * save values and Bento.saveState.load() to retrieve them.
 * <br>Exports: Object, can be accessed through Bento.saveState namespace.
 * @module bento/managers/savestate
 * @moduleName SaveStateManager
 * @returns SaveState
 */
bento.define('bento/managers/savestate', [
    'bento/utils'
], function (
    Utils
) {
    'use strict';
    var uniqueID = document.URL,
        storage,
        // an object that acts like a localStorageObject
        storageFallBack = {
            data: {},
            keys: [],
            length: 0,
            setItem: function (key, value) {
                var data = this.data;
                if (!data.hasOwnProperty(key)) {
                    this.keys.push(key);
                    this.length++;
                }
                data[key] = value;
            },
            getItem: function (key) {
                var item = this.data[key];
                return Utils.isDefined(item) ? item : null;
            },
            removeItem: function (key) {
                var index = this.keys.indexOf(key);
                if (index !== -1) {
                    this.keys.splice(index, 1);
                    this.length--;
                }
                delete this.data[key];
            },
            key: function (i) {
                return this.keys[i];
            },
            clear: function () {
                this.data = {};
                this.keys = [];
                this.length = 0;
            }
        };

    // initialize
    try {
        storage = window.localStorage;
        // try saving once
        if (window.localStorage) {
            window.localStorage.setItem(uniqueID + 'save', '0');
        } else {
            throw 'No local storage available';
        }
    } catch (e) {
        console.log('Warning: you have disabled cookies on your browser. You cannot save progress in your game.');
        storage = storageFallBack;
    }
    return {
        /**
         * Boolean that indicates if keys should be saved
         * @instance
         * @name saveKeys
         */
        saveKeys: false,
        /**
         * Saves/serializes a variable
         * @function
         * @instance
         * @param {String} key - Name of the variable
         * @param {Object} value - Number/Object/Array to be saved
         * @name save
         */
        save: function (elementKey, element) {
            var keys;
            if (!elementKey) {
                Utils.log("ERROR: savestate key is not defined.");
                return;
            }
            if (typeof elementKey !== 'string') {
                elementKey = JSON.stringify(elementKey);
            }
            if (element === undefined) {
                Utils.log("ERROR: Don't save a value as undefined, it can't be loaded back in. Use null instead.");
                element = null;
            }
            storage.setItem(uniqueID + elementKey, JSON.stringify(element));

            // also store the keys
            if (this.saveKeys) {
                keys = this.load('_keys', []);
                if (keys.indexOf(elementKey) > -1) {
                    return;
                }
                keys.push(elementKey);
                storage.setItem(uniqueID + '_keys', JSON.stringify(keys));
            }
        },
        /**
         * Adds to a saved variable/number
         * @function
         * @instance
         * @param {String} key - Name of the variable
         * @param {Object} value - Number to be added, if the value does not exists, it defaults to 0
         * @name add
         */
        add: function (elementKey, element) {
            if (!elementKey) {
                Utils.log("ERROR: savestate key is not defined.");
                return;
            }
            var value = this.load(elementKey, 0);
            value += element;
            this.save(elementKey, value);
        },
        /**
         * Loads/deserializes a variable
         * @function
         * @instance
         * @param {String} key - Name of the variable
         * @param {Object} defaultValue - The value returns if saved variable doesn't exists
         * @returns {Object} Returns saved value, otherwise defaultValue
         * @name load
         */
        load: function (elementKey, defaultValue) {
            var element;

            if (!elementKey) {
                Utils.log("ERROR: savestate key is not defined.");
                return;
            }

            element = storage.getItem(uniqueID + elementKey);
            if (element === null || element === undefined) {
                return defaultValue;
            }
            try {
                return JSON.parse(element);
            } catch (e) {
                Utils.log("ERROR: save file corrupted. " + e);
                return defaultValue;
            }
        },
        /**
         * Deletes a variable
         * @function
         * @instance
         * @param {String} key - Name of the variable
         * @name remove
         */
        remove: function (elementKey) {
            if (!elementKey) {
                Utils.log("ERROR: savestate key is not defined.");
                return;
            }
            storage.removeItem(uniqueID + elementKey);
        },
        /**
         * Clears the savestate
         * @function
         * @instance
         * @name clear
         */
        clear: function () {
            storage.clear();
        },
        debug: function () {
            console.log(localStorage);
        },
        /**
         * Checks if localStorage has values
         * @function
         * @instance
         * @name isEmpty
         */
        isEmpty: function () {
            return storage.length === 0;
        },
        /**
         * Returns a copy of the uniqueID.
         * @function
         * @instance
         * @returns {String} uniqueID of current game
         * @name getId
         */
        getId: function () {
            return uniqueID.slice(0);
        },
        /**
         * Sets an identifier that's prepended on every key.
         * By default this is the game's URL, to prevend savefile clashing.
         * @function
         * @instance
         * @param {String} name - ID name
         * @name setId
         */
        setId: function (str) {
            uniqueID = str;
        },
        /**
         * Swaps the storage object. Allows you to use something else than localStorage. But the storage object
         * must have similar methods as localStorage.
         * @function
         * @instance
         * @param {Object} storageObject - an object that resembels localStorage
         * @name setStorage
         */
        setStorage: function (storageObj) {
            storage = storageObj;
        },
        /**
         * Returns the current storage object
         * @function
         * @instance
         * @name getStorage
         */
        getStorage: function () {
            return storage;
        },
        /**
         * Returns an array of all save keys.
         * If saveKeys is false, array will be built from the ground up.
         * @function
         * @instance
         * @name getKeys
         */
        getKeys: function () {
            if (this.saveKeys) {
                return this.load('_keys', []);
            }
            var keys = [];
            var i, len, k;
            for (i = 0, len = storage.length; i < len; i++) {
                k = storage.key(i);
                if (k.indexOf(uniqueID) === 0) {
                    keys.push(k.slice(uniqueID.length));
                }
            }
            return keys;
        }
    };
});
/**
 * Manager that controls screens. Screens are defined as separate modules. See {@link module:bento/screen}. To show
 * your screen, simply call Bento.screens.show(). See {@link module:bento/managers/screen#show}.
 * <br>Exports: Constructor, can be accessed through Bento.screens namespace.
 * @module bento/managers/screen
 * @moudleName ScreenManager
 * @returns ScreenManager
 */
bento.define('bento/managers/screen', [
    'bento/eventsystem',
    'bento/utils'
], function (EventSystem, Utils) {
    'use strict';
    return function () {
        var screens = {};
        var currentScreen = null;
        var getScreen = function (name) {
            return screens[name];
        };
        var screenManager = {
            /**
             * Adds a new screen to the cache
             * @function
             * @instance
             * @param {Screen} screen - Screen object
             * @name add
             */
            add: function (screen) {
                if (!screen.name) {
                    throw 'Add name property to screen';
                }
                screens[screen.name] = screen;
            },
            /**
             * Shows a screen. If the screen was not added previously, it
             * will be loaded asynchronously by a require call.
             * @function
             * @instance
             * @param {String} name - Name of the screen
             * @param {Object} data - Extra data to pass on to the screen
             * @param {Function} callback - Called when screen is shown
             * @name show
             */
            show: function (name, data, callback) {
                if (currentScreen !== null) {
                    screenManager.hide({
                        next: name
                    });
                }
                currentScreen = screens[name];
                if (currentScreen) {
                    if (currentScreen.onShow) {
                        currentScreen.onShow(data);
                    }
                    EventSystem.fire('screenShown', currentScreen);
                    if (callback) {
                        callback();
                    }
                } else {
                    // load asynchronously
                    bento.require([name], function (screenObj) {
                        if (!screenObj.name) {
                            screenObj.name = name;
                        }
                        screenManager.add(screenObj);
                        // try again
                        screenManager.show(name, data, callback);
                    });
                }
            },
            /**
             * Hides a screen. You may call this to remove all objects on screen, but
             * it's not needed to call this yourself if you want to show a new screen.
             * Screens.hide is internally called on the current screen when Screens.show
             * is called.
             * @function
             * @instance
             * @param {Object} data - Extra data to pass on to the screen
             * @name hide
             */
            hide: function (data) {
                if (!currentScreen) {
                    return;
                }
                if (currentScreen.onHide) {
                    currentScreen.onHide(data);
                }
                EventSystem.fire('screenHidden', currentScreen);
                currentScreen = null;
            },
            /**
             * Return reference to the screen currently shown.
             * @function
             * @instance
             * @returns {Screen} The current screen
             * @name getCurrentScreen
             */
            getCurrentScreen: function () {
                return currentScreen;
            },
            /**
             * Clears cache of screens
             * @function
             * @instance
             * @name reset
             */
            reset: function () {
                screens = {};
            }
        };

        return screenManager;

    };
});
/**
 * A 2-dimensional array
 * <br>Exports: Constructor
 * @module bento/math/array2d
 * @moduleName Array2D
 * @param {Number} width - horizontal size of array
 * @param {Number} height - vertical size of array
 * @returns {Array} Returns 2d array.
 */
bento.define('bento/math/array2d', [], function () {
    'use strict';
    return function (width, height) {
        var array = [],
            i,
            j;

        // init array
        for (i = 0; i < width; ++i) {
            array[i] = [];
            for (j = 0; j < height; ++j) {
                array[i][j] = null;
            }
        }

        return {
            /**
             * Returns true
             * @function
             * @returns {Boolean} Is always true
             * @instance
             * @name isArray2d
             */
            isArray2d: function () {
                return true;
            },
            /**
             * Callback at every iteration.
             *
             * @callback IterationCallBack
             * @param {Number} x - The current x index
             * @param {Number} y - The current y index
             * @param {Number} value - The value at the x,y index
             */
            /**
             * Iterate through 2d array
             * @function
             * @param {IterationCallback} callback - Callback function to be called every iteration
             * @instance
             * @name iterate
             */
            iterate: function (callback) {
                var i, j;
                for (j = 0; j < height; ++j) {
                    for (i = 0; i < width; ++i) {
                        callback(i, j, array[i][j]);
                    }
                }
            },
            /**
             * Get the value inside array
             * @function
             * @param {Number} x - x index
             * @param {Number} y - y index
             * @returns {Object} The value at the index
             * @instance
             * @name get
             */
            get: function (x, y) {
                return array[x][y];
            },
            /**
             * Set the value inside array
             * @function
             * @param {Number} x - x index
             * @param {Number} y - y index
             * @param {Number} value - new value
             * @instance
             * @name set
             */
            set: function (x, y, value) {
                array[x][y] = value;
            }
        };
    };
});
/* DEPRECATED: use transformmatrix
 * Matrix
 * <br>Exports: Constructor
 * @module bento/math/matrix
 * @moduleName Matrix
 * @param {Number} width - horizontal size of matrix
 * @param {Number} height - vertical size of matrix
 * @returns {Matrix} Returns a matrix object.
 */
bento.define('bento/math/matrix', [
    'bento/utils'
], function (Utils) {
    'use strict';
    var add = function (other) {
            var newMatrix = this.clone();
            newMatrix.addTo(other);
            return newMatrix;
        },
        multiply = function (matrix1, matrix2) {
            var newMatrix = this.clone();
            newMatrix.multiplyWith(other);
            return newMatrix;
        },
        module = function (width, height) {
            var matrix = [],
                n = width || 0,
                m = height || 0,
                i,
                j,
                set = function (x, y, value) {
                    matrix[y * n + x] = value;
                },
                get = function (x, y) {
                    return matrix[y * n + x];
                };

            // initialize as identity matrix
            for (j = 0; j < m; ++j) {
                for (i = 0; i < n; ++i) {
                    if (i === j) {
                        set(i, j, 1);
                    } else {
                        set(i, j, 0);
                    }
                }
            }

            return {
                /*
                 * Returns true
                 * @function
                 * @returns {Boolean} Is always true
                 * @instance
                 * @name isMatrix
                 */
                isMatrix: function () {
                    return true;
                },
                /*
                 * Returns a string representation of the matrix (useful for debugging purposes)
                 * @function
                 * @returns {String} String matrix
                 * @instance
                 * @name stringify
                 */
                stringify: function () {
                    var i,
                        j,
                        str = '',
                        row = '';
                    for (j = 0; j < m; ++j) {
                        for (i = 0; i < n; ++i) {
                            row += get(i, j) + '\t';
                        }
                        str += row + '\n';
                        row = '';
                    }
                    return str;
                },
                /*
                 * Get the value inside matrix
                 * @function
                 * @param {Number} x - x index
                 * @param {Number} y - y index
                 * @returns {Number} The value at the index
                 * @instance
                 * @name get
                 */
                get: function (x, y) {
                    return get(x, y);
                },
                /*
                 * Set the value inside matrix
                 * @function
                 * @param {Number} x - x index
                 * @param {Number} y - y index
                 * @param {Number} value - new value
                 * @instance
                 * @name set
                 */
                set: function (x, y, value) {
                    set(x, y, value);
                },
                /*
                 * Set the values inside matrix using an array.
                 * If the matrix is 2x2 in size, then supplying an array with
                 * values [1, 2, 3, 4] will result in a matrix
                 * <br>[1 2]
                 * <br>[3 4]
                 * <br>If the array has more elements than the matrix, the
                 * rest of the array is ignored.
                 * @function
                 * @param {Array} array - array with Numbers
                 * @returns {Matrix} Returns self
                 * @instance
                 * @name setValues
                 */
                setValues: function (array) {
                    var i, l = Math.min(matrix.length, array.length);
                    for (i = 0; i < l; ++i) {
                        matrix[i] = array[i];
                    }
                    return this;
                },
                /*
                 * Get the matrix width
                 * @function
                 * @returns {Number} The width of the matrix
                 * @instance
                 * @name getWidth
                 */
                getWidth: function () {
                    return n;
                },
                /*
                 * Get the matrix height
                 * @function
                 * @returns {Number} The height of the matrix
                 * @instance
                 * @name getHeight
                 */
                getHeight: function () {
                    return m;
                },
                /*
                 * Callback at every iteration.
                 *
                 * @callback IterationCallBack
                 * @param {Number} x - The current x index
                 * @param {Number} y - The current y index
                 * @param {Number} value - The value at the x,y index
                 */
                /*
                 * Iterate through matrix
                 * @function
                 * @param {IterationCallback} callback - Callback function to be called every iteration
                 * @instance
                 * @name iterate
                 */
                iterate: function (callback) {
                    var i, j;
                    for (j = 0; j < m; ++j) {
                        for (i = 0; i < n; ++i) {
                            if (!Utils.isFunction(callback)) {
                                throw ('Please supply a callback function');
                            }
                            callback(i, j, get(i, j));
                        }
                    }
                },
                /*
                 * Transposes the current matrix
                 * @function
                 * @returns {Matrix} Returns self
                 * @instance
                 * @name transpose
                 */
                transpose: function () {
                    var i, j, newMat = [];
                    // reverse loop so m becomes n
                    for (i = 0; i < n; ++i) {
                        for (j = 0; j < m; ++j) {
                            newMat[i * m + j] = get(i, j);
                        }
                    }
                    // set new matrix
                    matrix = newMat;
                    // swap width and height
                    m = [n, n = m][0];
                    return this;
                },
                /*
                 * Addition of another matrix
                 * @function
                 * @param {Matrix} matrix - matrix to add
                 * @returns {Matrix} Updated matrix
                 * @instance
                 * @name addTo
                 */
                addTo: function (other) {
                    var i, j;
                    if (m != other.getHeight() || n != other.getWidth()) {
                        throw 'Matrix sizes incorrect';
                    }
                    for (j = 0; j < m; ++j) {
                        for (i = 0; i < n; ++i) {
                            set(i, j, get(i, j) + other.get(i, j));
                        }
                    }
                    return this;
                },
                /*
                 * Addition of another matrix
                 * @function
                 * @param {Matrix} matrix - matrix to add
                 * @returns {Matrix} A new matrix
                 * @instance
                 * @name add
                 */
                add: add,
                /*
                 * Multiply with another matrix
                 * If a new matrix C is the result of A * B = C
                 * then B is the current matrix and becomes C, A is the input matrix
                 * @function
                 * @param {Matrix} matrix - input matrix to multiply with
                 * @returns {Matrix} Updated matrix
                 * @instance
                 * @name multiplyWith
                 */
                multiplyWith: function (other) {
                    var i, j,
                        newMat = [],
                        newWidth = n, // B.n
                        oldHeight = m, // B.m
                        newHeight = other.getHeight(), // A.m
                        oldWidth = other.getWidth(), // A.n
                        newValue = 0,
                        k;
                    if (oldHeight != oldWidth) {
                        throw 'Matrix sizes incorrect';
                    }

                    for (j = 0; j < newHeight; ++j) {
                        for (i = 0; i < newWidth; ++i) {
                            newValue = 0;
                            // loop through matbentos
                            for (k = 0; k < oldWidth; ++k) {
                                newValue += other.get(k, j) * get(i, k);
                            }
                            newMat[j * newWidth + i] = newValue;
                        }
                    }
                    // set to new matrix
                    matrix = newMat;
                    // update matrix size
                    n = newWidth;
                    m = newHeight;
                    return this;
                },
                /*
                 * Multiply with another matrix
                 * If a new matrix C is the result of A * B = C
                 * then B is the current matrix and becomes C, A is the input matrix
                 * @function
                 * @param {Matrix} matrix - input matrix to multiply with
                 * @returns {Matrix} A new matrix
                 * @instance
                 * @name multiply
                 */
                multiply: multiply,
                /*
                 * Returns a clone of the current matrix
                 * @function
                 * @returns {Matrix} A new matrix
                 * @instance
                 * @name clone
                 */
                clone: function () {
                    var newMatrix = module(n, m);
                    newMatrix.setValues(matrix);
                    return newMatrix;
                }
            };
        };
    return module;
});
/**
 * Polygon
 * <br>Exports: Constructor
 * @module bento/math/polygon
 * @moduleName Polygon
 * @param {Array} points - An array of Vector2 with positions of all points
 * @returns {Polygon} Returns a polygon.
 */
// TODO: cleanup, change to prototype object
bento.define('bento/math/polygon', [
    'bento/utils',
    'bento/math/rectangle'
], function (Utils, Rectangle) {
    'use strict';
    var isPolygon = function () {
            return true;
        },
        clone = function () {
            var clone = [],
                points = this.points,
                i = points.length;
            // clone the array
            while (i--) {
                clone[i] = points[i];
            }
            return module(clone);
        },
        offset = function (pos) {
            var clone = [],
                points = this.points,
                i = points.length;
            while (i--) {
                clone[i] = points[i];
                clone[i].x += pos.x;
                clone[i].y += pos.y;
            }
            return module(clone);
        },
        doLineSegmentsIntersect = function (p, p2, q, q2) {
            // based on https://github.com/pgkelley4/line-segments-intersect
            var crossProduct = function (p1, p2) {
                    return p1.x * p2.y - p1.y * p2.x;
                },
                subtractPoints = function (p1, p2) {
                    return {
                        x: p1.x - p2.x,
                        y: p1.y - p2.y
                    };
                },
                r = subtractPoints(p2, p),
                s = subtractPoints(q2, q),
                uNumerator = crossProduct(subtractPoints(q, p), r),
                denominator = crossProduct(r, s),
                u,
                t;
            if (uNumerator === 0 && denominator === 0) {
                return ((q.x - p.x < 0) !== (q.x - p2.x < 0) !== (q2.x - p.x < 0) !== (q2.x - p2.x < 0)) ||
                    ((q.y - p.y < 0) !== (q.y - p2.y < 0) !== (q2.y - p.y < 0) !== (q2.y - p2.y < 0));
            }
            if (denominator === 0) {
                return false;
            }
            u = uNumerator / denominator;
            t = crossProduct(subtractPoints(q, p), s) / denominator;
            return (t >= 0) && (t <= 1) && (u >= 0) && (u <= 1);
        },
        intersect = function (polygon) {
            var intersect = false,
                other = [],
                points = this.points,
                p1,
                p2,
                q1,
                q2,
                i, ii,
                j, jj;

            // is other really a polygon?
            if (polygon.isRectangle) {
                // before constructing a polygon, check if boxes collide in the first place
                if (!this.getBoundingBox().intersect(polygon)) {
                    return false;
                }
                // construct a polygon out of rectangle
                other.push({
                    x: polygon.x,
                    y: polygon.y
                });
                other.push({
                    x: polygon.getX2(),
                    y: polygon.y
                });
                other.push({
                    x: polygon.getX2(),
                    y: polygon.getY2()
                });
                other.push({
                    x: polygon.x,
                    y: polygon.getY2()
                });
                polygon = module(other);
            } else {
                // simplest check first: regard polygons as boxes and check collision
                if (!this.getBoundingBox().intersect(polygon.getBoundingBox())) {
                    return false;
                }
                // get polygon points
                other = polygon.points;
            }

            // precision check
            for (i = 0, ii = points.length; i < ii; ++i) {
                for (j = 0, jj = other.length; j < jj; ++j) {
                    p1 = points[i];
                    p2 = points[(i + 1) % points.length];
                    q1 = other[j];
                    q2 = other[(j + 1) % other.length];
                    if (doLineSegmentsIntersect(p1, p2, q1, q2)) {
                        return true;
                    }
                }
            }
            // check inside one or another
            if (this.hasPosition(other[0]) || polygon.hasPosition(points[0])) {
                return true;
            } else {
                return false;
            }
        },
        hasPosition = function (p) {
            var points = this.points,
                has = false,
                i = 0,
                j = points.length - 1,
                l,
                bounds = this.getBoundingBox();

            if (p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height) {
                return false;
            }
            for (i, j, l = points.length; i < l; j = i++) {
                if ((points[i].y > p.y) != (points[j].y > p.y) &&
                    p.x < (points[j].x - points[i].x) * (p.y - points[i].y) /
                    (points[j].y - points[i].y) + points[i].x) {
                    has = !has;
                }
            }
            return has;
        },
        module = function (points) {
            var minX = points[0].x,
                maxX = points[0].x,
                minY = points[0].y,
                maxY = points[0].y,
                n = 1,
                q, l;

            for (n = 1, l = points.length; n < l; ++n) {
                q = points[n];
                minX = Math.min(q.x, minX);
                maxX = Math.max(q.x, maxX);
                minY = Math.min(q.y, minY);
                maxY = Math.max(q.y, maxY);
            }

            return {
                // TODO: use x and y as offset, widht and height as boundingbox
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                /**
                 * Array of Vector2 points
                 * @instance
                 * @name points
                 */
                points: points,
                /**
                 * Returns true
                 * @function
                 * @returns {Boolean} Is always true
                 * @instance
                 * @name isPolygon
                 */
                isPolygon: isPolygon,
                /**
                 * Get the rectangle containing the polygon
                 * @function
                 * @returns {Rectangle} Rectangle containing the polygon
                 * @instance
                 * @name getBoundingBox
                 */
                getBoundingBox: function () {
                    return new Rectangle(minX, minY, maxX - minX, maxY - minY);
                },
                /**
                 * Checks if Vector2 lies within the polygon
                 * @function
                 * @returns {Boolean} true if position is inside
                 * @instance
                 * @name hasPosition
                 */
                hasPosition: hasPosition,
                /**
                 * Checks if other polygon/rectangle overlaps.
                 * Note that this may be computationally expensive.
                 * @function
                 * @param {Polygon/Rectangle} other - Other polygon or rectangle
                 * @returns {Boolean} true if polygons overlap
                 * @instance
                 * @name intersect
                 */
                intersect: intersect,
                /**
                 * Moves polygon by an offset
                 * @function
                 * @param {Vector2} vector - Position to offset
                 * @returns {Polygon} Returns a new polygon instance
                 * @instance
                 * @name offset
                 */
                offset: offset,
                /**
                 * Clones polygon
                 * @function
                 * @returns {Polygon} a clone of the current polygon
                 * @instance
                 * @name clone
                 */
                clone: clone
            };
        };
    return module;
});
/**
 * Rectangle
 * <br>Exports: Constructor
 * @module bento/math/rectangle
 * @moduleName Rectangle
 * @param {Number} x - Top left x position
 * @param {Number} y - Top left y position
 * @param {Number} width - Width of the rectangle
 * @param {Number} height - Height of the rectangle
 * @returns {Rectangle} Returns a rectangle.
 * @snippet Rectangle|constructor
Rectangle(${1:0}, ${2:0}, ${3:1}, ${4:0})
 */
bento.define('bento/math/rectangle', [
    'bento/utils',
    'bento/math/vector2'
], function (
    Utils,
    Vector2
) {
    'use strict';
    var Rectangle = function (x, y, width, height) {
        if (!(this instanceof Rectangle)) {
            return new Rectangle(x, y, width, height);
        }
        if (Utils.isDev()) {
            if (
                !Utils.isNumber(x) ||
                !Utils.isNumber(y) ||
                !Utils.isNumber(width) ||
                !Utils.isNumber(height) ||
                isNaN(x) ||
                isNaN(y) ||
                isNaN(width) ||
                isNaN(height)
            ) {
                Utils.log(
                    "WARNING: invalid Rectangle state! x: " + x +
                    ", y: " + y +
                    ", width: " + width +
                    ", height: " + height
                );
            }
        }

        /**
         * X position
         * @instance
         * @name x
         * @snippet #Rectangle.x|Number
            x
         */
        this.x = x || 0;
        /**
         * Y position
         * @instance
         * @name y
         * @snippet #Rectangle.y|Number
            y
         */
        this.y = y || 0;
        /**
         * Width of the rectangle
         * @instance
         * @name width
         * @snippet #Rectangle.width|Number
            width
         */
        this.width = width || 0;
        /**
         * Height of the rectangle
         * @instance
         * @name height
         * @snippet #Rectangle.height|Number
            height
         */
        this.height = height || 0;
    };
    /**
     * Returns true
     * @function
     * @returns {Boolean} Is always true
     * @instance
     * @name isRectangle
     */
    Rectangle.prototype.isRectangle = function () {
        return true;
    };
    /**
     * Gets the lower right x position
     * @function
     * @returns {Number} Coordinate of the lower right position
     * @instance
     * @name getX2
     * @snippet #Rectangle.getX2|Number
        getX2();
     */
    Rectangle.prototype.getX2 = function () {
        return this.x + this.width;
    };
    /**
     * Gets the lower right y position
     * @function
     * @returns {Number} Coordinate of the lower right position
     * @instance
     * @name getY2
     * @snippet #Rectangle.getY2|Number
        getY2();
     */
    Rectangle.prototype.getY2 = function () {
        return this.y + this.height;
    };
    /**
     * Returns the union of 2 rectangles
     * @function
     * @param {Rectangle} other - Other rectangle
     * @returns {Rectangle} Union of the 2 rectangles
     * @instance
     * @name union
     * @snippet #Rectangle.union|Rectangle
        union(${1:otherRectangle});
     */
    Rectangle.prototype.union = function (rectangle) {
        var x1 = Math.min(this.x, rectangle.x),
            y1 = Math.min(this.y, rectangle.y),
            x2 = Math.max(this.getX2(), rectangle.getX2()),
            y2 = Math.max(this.getY2(), rectangle.getY2());
        return new Rectangle(x1, y1, x2 - x1, y2 - y1);
    };
    /**
     * Returns true if 2 rectangles intersect
     * @function
     * @param {Rectangle} other - Other rectangle
     * @returns {Boolean} True if 2 rectangles intersect
     * @instance
     * @name intersect
     * @snippet #Rectangle.intersect|Boolean
        intersect(${1:otherRectangle});
     */
    Rectangle.prototype.intersect = function (other) {
        if (other.isPolygon) {
            return other.intersect(this);
        } else {
            return !(this.x + this.width <= other.x ||
                this.y + this.height <= other.y ||
                this.x >= other.x + other.width ||
                this.y >= other.y + other.height);
        }
    };
    /**
     * Returns the intersection of 2 rectangles
     * @function
     * @param {Rectangle} other - Other rectangle
     * @returns {Rectangle} Intersection of the 2 rectangles
     * @instance
     * @name intersection
     * @snippet #Rectangle.intersection|Rectangle
        intersectuib(${1:otherRectangle});
     */
    Rectangle.prototype.intersection = function (rectangle) {
        var inter = new Rectangle(0, 0, 0, 0);
        if (this.intersect(rectangle)) {
            inter.x = Math.max(this.x, rectangle.x);
            inter.y = Math.max(this.y, rectangle.y);
            inter.width = Math.min(this.x + this.width, rectangle.x + rectangle.width) - inter.x;
            inter.height = Math.min(this.y + this.height, rectangle.y + rectangle.height) - inter.y;
        }
        return inter;
    };
    /**
     * Checks if rectangle intersects with the provided circle
     * @function
     * @param {Vector2} circleCenter
     * @param {Number} radius
     * @returns {Boolean} True if rectangle and circle intersect
     * @instance
     * @name intersectsCircle
     * @snippet #Rectangle.intersectsCircle|Boolean
        intersectsCircle(${1:centerVector}, ${2:radius});
     */
    Rectangle.prototype.intersectsCircle = function (circleCenter, radius) {
        var rectHalfWidth = this.width * 0.5;
        var rectHalfHeight = this.height * 0.5;
        var rectCenter = new Vector2(this.x + rectHalfWidth, this.y + rectHalfHeight);
        var distanceX = Math.abs(circleCenter.x - rectCenter.x);
        var distanceY = Math.abs(circleCenter.y - rectCenter.y);
        var cornerDistanceSq = 0;

        if (distanceX > rectHalfWidth + radius || distanceY > rectHalfHeight + radius) {
            return false;
        }

        if (distanceX <= rectHalfWidth || distanceY <= rectHalfHeight) {
            return true;
        }

        cornerDistanceSq = (distanceX - rectHalfWidth) * (distanceX - rectHalfWidth) + (distanceY - rectHalfHeight) * (distanceY - rectHalfHeight);

        return cornerDistanceSq <= radius * radius;
    };
    /**
     * Checks if rectangle intersects with the provided line
     * @function
     * @param {Vector2} lineOrigin
     * @param {Vector2} lineEnd
     * @returns {Boolean} True if rectangle and line intersect
     * @instance
     * @name intersectsLine
     * @snippet #Rectangle.intersectsLine|Boolean
        intersectsLine(${1:originVector}, ${2:endVector});
     */
    Rectangle.prototype.intersectsLine = function (lineOrigin, lineEnd) {
        // linesIntersect adapted from: https://gist.github.com/Joncom/e8e8d18ebe7fe55c3894
        var linesIntersect = function (p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
            var s1x = p1x - p0x;
            var s1y = p1y - p0y;
            var s2x = p3x - p2x;
            var s2y = p3y - p2y;

            var s = (-s1y * (p0x - p2x) + s1x * (p0y - p2y)) / (-s2x * s1y + s1x * s2y);
            var t = (s2x * (p0y - p2y) - s2y * (p0x - p2x)) / (-s2x * s1y + s1x * s2y);

            return s >= 0 && s <= 1 && t >= 0 && t <= 1;
        };

        var x1 = this.x;
        var y1 = this.y;
        var x2 = this.getX2();
        var y2 = this.getY2();

        return this.hasPosition(lineOrigin) && this.hasPosition(lineEnd) || // line is inside of rectangle
            linesIntersect(lineOrigin.x, lineOrigin.y, lineEnd.x, lineEnd.y, x1, y1, x1, y2) || // line intersects left side
            linesIntersect(lineOrigin.x, lineOrigin.y, lineEnd.x, lineEnd.y, x1, y1, x2, y1) || // line intersects top side
            linesIntersect(lineOrigin.x, lineOrigin.y, lineEnd.x, lineEnd.y, x2, y1, x2, y2) || // line intersects right side
            linesIntersect(lineOrigin.x, lineOrigin.y, lineEnd.x, lineEnd.y, x1, y2, x2, y2); // line intersects bottom side
    };
    /**
     * Returns a new rectangle that has been moved by the offset
     * @function
     * @param {Vector2} vector - Position to offset
     * @returns {Rectangle} Returns a new rectangle instance
     * @instance
     * @name offset
     * @snippet #Rectangle.offset|Rectangle
        offset(${1:vector});
     */
    Rectangle.prototype.offset = function (pos) {
        return new Rectangle(this.x + pos.x, this.y + pos.y, this.width, this.height);
    };
    /**
     * Clones rectangle
     * @function
     * @returns {Rectangle} a clone of the current rectangle
     * @instance
     * @name clone
     * @snippet #Rectangle.clone|Rectangle
        clone();
     */
    Rectangle.prototype.clone = function () {
        return new Rectangle(this.x, this.y, this.width, this.height);
    };

    /**
     * Clones this Rectangle's values into another
     * @function
     * @param {Rectangle} rectangle - Other rectangle to receive new values
     * @returns {Rectangle} self
     * @instance
     * @name copyInto
     * @snippet #Rectangle.copyInto|Rectangle
        copyInto(${1:targetRectangle});
     */
    Rectangle.prototype.copyInto = function (other) {
        other.x = this.x;
        other.y = this.y;
        other.width = this.width;
        other.height = this.height;
        return this;
    };

    /**
     * Checks if Vector2 lies within the rectangle
     * @function
     * @returns {Boolean} true if position is inside
     * @instance
     * @name hasPosition
     * @snippet #Rectangle.hasPosition|Boolean
        hasPosition(${1:vector});
     */
    Rectangle.prototype.hasPosition = function (vector) {
        return !(
            vector.x < this.x ||
            vector.y < this.y ||
            vector.x >= this.x + this.width ||
            vector.y >= this.y + this.height
        );
    };
    /**
     * Increases rectangle size from the center.
     * @function
     * param {Number} size - by how much to scale the rectangle
     * param {Boolean} skipWidth - optional. If true, the width won't be scaled
     * param {Boolean} skipHeight - optional. If true, the height won't be scaled
     * @returns {Rectangle} the resized rectangle
     * @instance
     * @name grow
     * @snippet #Rectangle.grow|Rectangle
        hasPosition(${1:Number});
     * @snippet #Rectangle.grow|skip width
        hasPosition(${1:Number}, true);
     * @snippet #Rectangle.grow|skip height
        hasPosition(${1:Number}, false, true);
     */
    Rectangle.prototype.grow = function (size, skipWidth, skipHeight) {
        if (!skipWidth) {
            this.x -= size / 2;
            this.width += size;
        }
        if (!skipHeight) {
            this.y -= size / 2;
            this.height += size;
        }
        return this;
    };
    /**
       * Ensures the rectangle contains the provided position, extending if necessary.
       * @function
       * param {Vector2} position - the position the rectangle should contain
       * @returns {Rectangle} the update rectangle
       * @instance
       * @name includePosition
       * @snippet #Rectangle.includePosition|Rectangle
          includePosition(${1:Vector2});
    */
    Rectangle.prototype.includePosition = function (position) {
        if (this.hasPosition(position)) return this;

        var diff;

        if (position.x < this.x) {
            diff = this.x - position.x;
            this.x -= diff;
            this.width += diff;
        } else if (position.x > this.x + this.width) {
            diff = position.x - (this.x + this.width);
            this.width += diff;
        }

        if (position.y < this.y) {
            diff = this.y - position.y;
            this.y -= diff;
            this.height += diff;
        } else if (position.y > this.y + this.height) {
            diff = position.y - (this.y + this.height);
            this.height += diff;
        }

        return this;
    };
    /**
     * Returns one of the corners are vector position
     * @function
     * param {Number} corner - 0: topleft, 1: topright, 2: bottomleft, 3: bottomright, 4: center
     * @returns {Vector2} Vector position
     * @instance
     * @name getCorner
     * @snippet #Rectangle.getCorner|Vector2
        getCorner(Rectangle.BOTTOMRIGHT);
     * @snippet Rectangle.TOPLEFT|corner
        Rectangle.TOPLEFT
     * @snippet Rectangle.TOPRIGHT|corner
        Rectangle.TOPRIGHT
     * @snippet Rectangle.BOTTOMLEFT|corner
        Rectangle.BOTTOMLEFT
     * @snippet Rectangle.BOTTOMRIGHT|corner
        Rectangle.BOTTOMRIGHT
     * @snippet Rectangle.CENTER|corner
        Rectangle.CENTER
     */
    Rectangle.TOPLEFT = 0;
    Rectangle.TOPRIGHT = 1;
    Rectangle.BOTTOMLEFT = 2;
    Rectangle.BOTTOMRIGHT = 3;
    Rectangle.CENTER = 4;
    Rectangle.prototype.getCorner = function (corner) {
        if (!corner) {
            return new Vector2(this.x, this.y);
        } else if (corner === 1) {
            return new Vector2(this.x + this.width, this.y);
        } else if (corner === 2) {
            return new Vector2(this.x, this.y + this.height);
        } else if (corner === 3) {
            return new Vector2(this.x + this.width, this.y + this.height);
        }
        //
        return new Vector2(this.x + this.width / 2, this.y + this.height / 2);
    };
    /**
     * Returns the center position of the rectangle
     * @function
     * @returns {Vector2} Vector position
     * @instance
     * @name getCenter
     * @snippet #Rectangle.getCenter|Vector2
        getCenter();
     */
    Rectangle.prototype.getCenter = function () {
        return new Vector2(this.x + this.width / 2, this.y + this.height / 2);
    };
    /**
     * Returns a clone with only the width and height cloned
     * @function
     * @returns {Rectangle} a clone of the current rectangle with x and y set to 0
     * @instance
     * @name getSize
     * @snippet #Rectangle.getSize|Rectangle
        getSize();
     */
    Rectangle.prototype.getSize = function () {
        return new Rectangle(0, 0, this.width, this.height);
    };
    /**
     * Returns a Vector2 half the size of the rectangle
     * @function
     * @returns {Vector2} Vector2 half the size of the rectangle
     * @instance
     * @name getExtents
     * @snippet #Rectangle.getExtents|Vector2
        getExtents();
     */
    Rectangle.prototype.getExtents = function () {
        return new Vector2(this.width / 2, this.height / 2);
    };
    Rectangle.prototype.toString = function () {
        return '[object Rectangle]';
    };

    // ==== Static functions and properties ====
    /**
     * Copies values into another instance
     * @function
     * @param {Rectangle} source - Source instance to copy from
     * @param {Rectangle} target - Target instance to receive values
     * @returns {Rectangle} Target Rectangle
     * @instance
     * @static
     * @name copyInto
     * @snippet Rectangle.copyInto|Rectangle
        Rectangle.copyInto(${1:source}, ${2:target})
     */
    Rectangle.copyInto = function (source, target) {
        source.copyInto(target);
    };

    return Rectangle;
});
/**
 * 3x 3 Matrix specifically used for transformations
 * <br>[ a c tx ]
 * <br>[ b d ty ]
 * <br>[ 0 0 1  ]
 * <br>Exports: Constructor
 * @module bento/math/transformmatrix
 * @moduleName TransformMatrix
 * @returns {Matrix} Returns a matrix object.
 */
bento.define('bento/math/transformmatrix', [
    'bento/utils',
    'bento/math/vector2'
], function (
    Utils,
    Vector2
) {
    'use strict';

    var Matrix = function () {
        if (!(this instanceof Matrix)) {
            return new Matrix();
        }
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.tx = 0;
        this.ty = 0;
    };

    /**
     * Applies matrix on a vector
     * @function
     * @returns {Vector2} Transformed vector
     * @instance
     * @name multiplyWithVector
     */
    Matrix.prototype.multiplyWithVector = function (vector) {
        var x = vector.x;
        var y = vector.y;

        vector.x = this.a * x + this.c * y + this.tx;
        vector.y = this.b * x + this.d * y + this.ty;

        return vector;
    };

    Matrix.prototype.inverseMultiplyWithVector = function (vector) {
        var x = vector.x;
        var y = vector.y;
        var determinant = 1 / (this.a * this.d - this.c * this.b);

        vector.x = this.d * x * determinant + -this.c * y * determinant + (this.ty * this.c - this.tx * this.d) * determinant;
        vector.y = this.a * y * determinant + -this.b * x * determinant + (-this.ty * this.a + this.tx * this.b) * determinant;

        return vector;
    };

    /**
     * Apply translation transformation on the matrix
     * @function
     * @param {Number} x - Translation in x axis
     * @param {Number} y - Translation in y axis
     * @returns {Matrix} Matrix with translation transform
     * @instance
     * @name translate
     */
    Matrix.prototype.translate = function (x, y) {
        this.tx += x;
        this.ty += y;

        return this;
    };

    /**
     * Apply scale transformation on the matrix
     * @function
     * @param {Number} x - Scale in x axis
     * @param {Number} y - Scale in y axis
     * @returns {Matrix} Matrix with scale transform
     * @instance
     * @name scale
     */
    Matrix.prototype.scale = function (x, y) {
        this.a *= x;
        this.b *= y;
        this.c *= x;
        this.d *= y;
        this.tx *= x;
        this.ty *= y;

        return this;
    };

    /**
     * Apply rotation transformation on the matrix
     * @function
     * @param {Number} angle - Angle to rotate in radians
     * @param {Number} [sin] - Precomputed sin(angle) if known
     * @param {Number} [cos] - Precomputed cos(angle) if known
     * @returns {Matrix} Matrix with rotation transform
     * @instance
     * @name rotate
     */
    Matrix.prototype.rotate = function (angle, sin, cos) {
        var a = this.a;
        var b = this.b;
        var c = this.c;
        var d = this.d;
        var tx = this.tx;
        var ty = this.ty;

        if (sin === undefined) {
            sin = Math.sin(angle);
        }
        if (cos === undefined) {
            cos = Math.cos(angle);
        }

        this.a = a * cos - b * sin;
        this.b = a * sin + b * cos;
        this.c = c * cos - d * sin;
        this.d = c * sin + d * cos;
        this.tx = tx * cos - ty * sin;
        this.ty = tx * sin + ty * cos;

        return this;
    };

    /**
     * Multiplies matrix
     * @function
     * @param {Matrix} matrix - Matrix to multiply with
     * @returns {Matrix} Self
     * @instance
     * @name multiplyWith
     */
    Matrix.prototype.multiplyWith = function (matrix) {
        var a = this.a;
        var b = this.b;
        var c = this.c;
        var d = this.d;

        this.a = matrix.a * a + matrix.b * c;
        this.b = matrix.a * b + matrix.b * d;
        this.c = matrix.c * a + matrix.d * c;
        this.d = matrix.c * b + matrix.d * d;
        this.tx = matrix.tx * a + matrix.ty * c + this.tx;
        this.ty = matrix.tx * b + matrix.ty * d + this.ty;

        return this;
    };
    /**
     * Multiplies matrix
     * @function
     * @param {Matrix} matrix - Matrix to multiply with
     * @returns {Matrix} Cloned matrix
     * @instance
     * @name multiply
     */
    Matrix.prototype.multiply = function (matrix) {
        return this.clone().multiplyWith(matrix);
    };

    /**
     * Clones matrix
     * @function
     * @returns {Matrix} Cloned matrix
     * @instance
     * @name clone
     */
    Matrix.prototype.clone = function () {
        var matrix = new Matrix();
        matrix.a = this.a;
        matrix.b = this.b;
        matrix.c = this.c;
        matrix.d = this.d;
        matrix.tx = this.tx;
        matrix.ty = this.ty;

        return matrix;
    };

    /**
     * Clones this matrix values into another
     * @function
     * @param {Matrix} matrix - Matrix to receive new values
     * @returns {Matrix} self
     * @instance
     * @name copyInto
     */
    Matrix.prototype.copyInto = function (other) {
        other.a = this.a;
        other.b = this.b;
        other.c = this.c;
        other.d = this.d;
        other.tx = this.tx;
        other.ty = this.ty;
        return this;
    };

    /**
     * Resets matrix to identity matrix
     * @function
     * @returns {Matrix} Self
     * @instance
     * @name reset
     */
    Matrix.prototype.reset = function () {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.tx = 0;
        this.ty = 0;
        return this;
    };
    Matrix.prototype.identity = Matrix.prototype.reset;

    /**
     * Prepend matrix
     * @function
     * @param {Matrix} Other matrix
     * @instance
     * @returns {Matrix} Self
     */
    Matrix.prototype.prependWith = function (matrix) {
        var selfTx = this.tx;
        var selfA = this.a;
        var selfC = this.c;

        this.a = selfA * matrix.a + this.b * matrix.c;
        this.b = selfA * matrix.b + this.b * matrix.d;
        this.c = selfC * matrix.a + this.d * matrix.c;
        this.d = selfC * matrix.b + this.d * matrix.d;

        this.tx = selfTx * matrix.a + this.ty * matrix.c + matrix.tx;
        this.ty = selfTx * matrix.b + this.ty * matrix.d + matrix.ty;

        return this;
    };

    /**
     * Prepends matrix
     * @function
     * @param {Matrix} matrix - Matrix to prepend
     * @returns {Matrix} Cloned matrix
     * @instance
     * @name prepend
     */
    Matrix.prototype.prepend = function (matrix) {
        return this.clone().prependWith(matrix);
    };

    // aliases
    Matrix.prototype.appendWith = Matrix.prototype.multiplyWith;
    Matrix.prototype.append = Matrix.prototype.multiply;

    Matrix.prototype.toString = function () {
        return '[object Matrix]';
    };
    return Matrix;
});
/**
 * 2 dimensional vector
 * (Note: to perform matrix multiplications, one must use toMatrix)
 * <br>Exports: Constructor
 * @module bento/math/vector2
 * @moduleName Vector2
 * @param {Number} x - x position
 * @param {Number} y - y position
 * @returns {Vector2} Returns a 2d vector.
 * @snippet Vector2|constructor
Vector2(${1:0}, ${2:0})
 * @snippet #Vector2.x|Number
    x
 * @snippet #Vector2.y|Number
    y
 *
 */
bento.define('bento/math/vector2', [
    'bento/math/matrix',
    'bento/utils'
], function (
    Matrix,
    Utils
) {
    'use strict';
    var Vector2 = function (x, y) {
        if (!(this instanceof Vector2)) {
            return new Vector2(x, y);
        }
        if (Utils.isDev()) {
            if (!Utils.isNumber(x) || !Utils.isNumber(y) || isNaN(x) || isNaN(y)) {
                Utils.log("WARNING: invalid Vector2 state! x: " + x + ", y: " + y);
            }
        }
        this.x = x || 0;
        this.y = y || 0;
    };

    Vector2.prototype.isVector2 = function () {
        return true;
    };
    /**
     * Adds 2 vectors and returns the result
     * @function
     * @param {Vector2} vector - Vector to add
     * @returns {Vector2} Returns a new Vector2 instance
     * @instance
     * @name add
     * @snippet #Vector2.add|Vector2
        add(${1:otherVector});
     */
    Vector2.prototype.add = function (vector) {
        var v = this.clone();
        v.addTo(vector);
        return v;
    };
    /**
     * Adds vector to current vector
     * @function
     * @param {Vector2} vector - Vector to add
     * @returns {Vector2} Returns self
     * @instance
     * @name addTo
     * @snippet #Vector2.addTo|self
        addTo(${1:otherVector});
     */
    Vector2.prototype.addTo = function (vector) {
        this.x += vector.x;
        this.y += vector.y;
        return this;
    };
    /**
     * Subtracts a vector and returns the result
     * @function
     * @param {Vector2} vector - Vector to subtract
     * @returns {Vector2} Returns a new Vector2 instance
     * @instance
     * @name subtract
     * @snippet #Vector2.subtract|Vector2
        subtract(${1:otherVector});
     */
    Vector2.prototype.subtract = function (vector) {
        var v = this.clone();
        v.substractFrom(vector);
        return v;
    };
    /**
     * Subtract from the current vector
     * @function
     * @param {Vector2} vector - Vector to subtract
     * @returns {Vector2} Returns self
     * @instance
     * @name subtractFrom
     * @snippet #Vector2.subtractFrom|self
        subtractFrom(${1:otherVector});
     */
    Vector2.prototype.subtractFrom = function (vector) {
        this.x -= vector.x;
        this.y -= vector.y;
        return this;
    };
    Vector2.prototype.substract = Vector2.prototype.subtract;
    Vector2.prototype.substractFrom = Vector2.prototype.subtractFrom;
    /**
     * Gets the angle of the vector
     * @function
     * @returns {Number} Angle in radians
     * @instance
     * @name angle
     * @snippet #Vector2.angle|radians
        angle();
     */
    Vector2.prototype.angle = function () {
        return Math.atan2(this.y, this.x);
    };
    /**
     * Gets the angle between 2 vectors
     * @function
     * @param {Vector2} vector - Other vector
     * @returns {Number} Angle in radians
     * @instance
     * @name angleBetween
     * @snippet #Vector2.angleBetween|radians
        angleBetween(${1:otherVector});
     */
    Vector2.prototype.angleBetween = function (vector) {
        return Math.atan2(
            vector.y - this.y,
            vector.x - this.x
        );
    };
    /**
     * Gets the inner product between 2 vectors
     * @function
     * @param {Vector2} vector - Other vector
     * @returns {Number} Dot product of 2 vectors
     * @instance
     * @name dotProduct
     * @snippet #Vector2.dotProduct|Number
        dotProduct(${1:otherVector});
     */
    Vector2.prototype.dotProduct = function (vector) {
        return this.x * vector.x + this.y * vector.y;
    };
    /**
     * Multiplies 2 vectors (not a matrix multiplication)
     * @function
     * @param {Vector2} vector - Other vector
     * @returns {Vector2} Returns a new Vector2 instance
     * @instance
     * @name multiply
     * @snippet #Vector2.multiply|Vector2
        multiply(${1:otherVector});
     */
    Vector2.prototype.multiply = function (vector) {
        var v = this.clone();
        v.multiplyWith(vector);
        return v;
    };
    /**
     * Multiply with the current vector (not a matrix multiplication)
     * @function
     * @param {Vector2} vector - Other vector
     * @returns {Vector2} Returns self
     * @instance
     * @name multiplyWith
     * @snippet #Vector2.multiplyWith|self
        multiplyWith(${1:otherVector});
     */
    Vector2.prototype.multiplyWith = function (vector) {
        this.x *= vector.x;
        this.y *= vector.y;
        return this;
    };
    /**
     * Divides 2 vectors
     * @function
     * @param {Vector2} vector - Other vector
     * @returns {Vector2} Returns a new Vector2 instance
     * @instance
     * @name divide
     * @snippet #Vector2.divide|Vector2
        divide(${1:otherVector});
     */
    Vector2.prototype.divide = function (vector) {
        var v = this.clone();
        v.divideBy(vector);
        return v;
    };
    /**
     * Divides current vector
     * @function
     * @param {Vector2} vector - Other vector
     * @returns {Vector2} Returns a new Vector2 instance
     * @instance
     * @name divideBy
     * @snippet #Vector2.divideBy|Vector2
        divideBy(${1:otherVector});
     */
    Vector2.prototype.divideBy = function (vector) {
        this.x /= vector.x;
        this.y /= vector.y;
        return this;
    };
    /**
     * Multiplies vector with a scalar value
     * @function
     * @param {Number} value - scalar value
     * @returns {Vector2} Returns a new Vector2 instance
     * @instance
     * @name scalarMultiply
     * @snippet #Vector2.scalarMultiply|Vector2
        scalarMultiply(${1:1});
     */
    Vector2.prototype.scalarMultiply = function (value) {
        var v = this.clone();
        v.scalarMultiplyWith(value);
        return v;
    };
    /**
     * Multiplies current vector with a scalar value
     * @function
     * @param {Number} value - scalar value
     * @returns {Vector2} Returns self
     * @instance
     * @name scalarMultiplyWith
     * @snippet #Vector2.scalarMultiplyWith|self
        scalarMultiplyWith(${1:1});
     */
    Vector2.prototype.scalarMultiplyWith = function (value) {
        this.x *= value;
        this.y *= value;
        return this;
    };
    /**
     * Same as scalarMultiplyWith
     * @function
     * @param {Number} value - scalar value
     * @returns {Vector2} Returns self
     * @instance
     * @name scale
     * @snippet #Vector2.scale|self
        scale(${1:1});
     */
    Vector2.prototype.scale = Vector2.prototype.scalarMultiplyWith;
    /**
     * Returns the magnitude of the vector
     * @function
     * @returns {Number} Modulus of the vector
     * @instance
     * @name magnitude
     * @snippet #Vector2.magnitude|Number
        magnitude();
     */
    Vector2.prototype.magnitude = function () {
        return Math.sqrt(this.sqrMagnitude());
    };
    /**
     * Returns the magnitude of the vector without squarerooting it (which is an expensive operation)
     * @function
     * @returns {Number} Modulus squared of the vector
     * @instance
     * @name sqrMagnitude
     * @snippet #Vector2.sqrMagnitude|Number
        sqrMagnitude();
     */
    Vector2.prototype.sqrMagnitude = function () {
        return this.dotProduct(this);
    };
    /**
     * Normalizes the vector by its magnitude
     * @function
     * @returns {Vector2} Returns self
     * @instance
     * @name normalize
     * @snippet #Vector2.normalize|self
        normalize();
     */
    Vector2.prototype.normalize = function () {
        var magnitude = this.magnitude();
        if (magnitude === 0) {
            // divide by zero
            this.x = 0;
            this.y = 0;
            return this;
        }
        this.x /= magnitude;
        this.y /= magnitude;
        return this;
    };
    /**
     * Returns the distance from another vector
     * @function
     * @param {Vector2} vector - Other vector
     * @returns {Number} Distance between the two vectors
     * @instance
     * @name distance
     * @snippet #Vector2.distance|Number
        distance(${1:otherVector});
     */
    Vector2.prototype.distance = function (vector) {
        return vector.substract(this).magnitude();
    };
    /**
     * Check if distance between 2 vector is farther than a certain value
     * This function is more performant than using Vector2.distance()
     * @function
     * @param {Vector2} vector - Other vector
     * @param {Number} distance - Distance
     * @returns {Boolean} Returns true if farther than distance
     * @instance
     * @name isFartherThan
     * @snippet #Vector2.isFartherThan|Boolean
        isFartherThan(${1:otherVector}, ${2:1});
     */
    Vector2.prototype.isFartherThan = function (vector, distance) {
        var diff = vector.substract(this);
        return diff.x * diff.x + diff.y * diff.y > distance * distance;
    };
    /**
     * Check if distance between 2 vector is closer than a certain value
     * This function is more performant than using Vector2.distance()
     * @function
     * @param {Vector2} vector - Other vector
     * @param {Number} distance - Distance
     * @returns {Boolean} Returns true if farther than distance
     * @instance
     * @name isCloserThan
     * @snippet #Vector2.isCloserThan|Boolean
        isCloserThan(${1:otherVector}, ${2:1});
     */
    Vector2.prototype.isCloserThan = function (vector, distance) {
        var diff = vector.substract(this);
        return diff.x * diff.x + diff.y * diff.y < distance * distance;
    };
    /**
     * Rotates the vector by a certain amount of radians
     * @function
     * @param {Number} angle - Angle in radians
     * @returns {Vector2} Returns self
     * @instance
     * @name rotateRadian
     * @snippet #Vector2.rotateRadian|self
        rotateRadian(${1:radians});
     */
    Vector2.prototype.rotateRadian = function (angle) {
        var x = this.x * Math.cos(angle) - this.y * Math.sin(angle),
            y = this.x * Math.sin(angle) + this.y * Math.cos(angle);
        this.x = x;
        this.y = y;
        return this;
    };
    /**
     * Rotates the vector by a certain amount of degrees
     * @function
     * @param {Number} angle - Angle in degrees
     * @returns {Vector2} Returns self
     * @instance
     * @name rotateDegree
     * @snippet #Vector2.rotateDegree|self
        rotateRadian(${1:degrees});
     */
    Vector2.prototype.rotateDegree = function (angle) {
        return this.rotateRadian(angle * Math.PI / 180);
    };
    /**
     * Clones the current vector
     * @function
     * @param {Number} angle - Angle in degrees
     * @returns {Vector2} Returns new Vector2 instance
     * @instance
     * @name clone
     * @snippet #Vector2.clone|Vector2
        clone();
     */
    Vector2.prototype.clone = function () {
        return new Vector2(this.x, this.y);
    };
    /**
     * Clones this Vector2's values into another
     * @function
     * @param {Vector2} vector - Other vector to receive new values
     * @returns {Vector2} self
     * @instance
     * @name copyInto
     * @snippet #Vector2.copyInto|Vector2
        copyInto(${1:targetVector});
     */
    Vector2.prototype.copyInto = function (other) {
        other.x = this.x;
        other.y = this.y;
        return this;
    };
    /* DEPRECATED
     * Represent the vector as a 1x3 matrix
     * @function
     * @returns {Matrix} Returns a 1x3 Matrix
     * @instance
     * @name toMatrix
     */
    Vector2.prototype.toMatrix = function () {
        var matrix = new Matrix(1, 3);
        matrix.set(0, 0, this.x);
        matrix.set(0, 1, this.y);
        matrix.set(0, 2, 1);
        return matrix;
    };
    /**
     * Reflects the vector using the parameter as the 'mirror'
     * @function
     * @param {Vector2} mirror - Vector2 through which the current vector is reflected.
     * @instance
     * @name reflect
     * @snippet #Vector2.reflect|Vector2
        reflect(${1:mirrorVector});
     */
    Vector2.prototype.reflect = function (mirror) {
        var normal = mirror.normalize(); // reflect through this normal
        var dot = this.dotProduct(normal);
        return this.substractFrom(normal.scalarMultiplyWith(dot + dot));
    };
    Vector2.prototype.toString = function () {
        return '[object Vector2]';
    };

    // ==== Static functions and properties ====
    /**
     * Copies values into another instance
     * @function
     * @param {Vector2} source - Source instance to copy from
     * @param {Vector2} target - Target instance to receive values
     * @returns {Vector2} Target Vector2
     * @instance
     * @static
     * @name copyInto
     * @snippet Vector2.copyInto|Vector2
        Vector2.copyInto(${1:source}, ${2:target})
     */
    Vector2.copyInto = function (source, target) {
        source.copyInto(target);
    };

    /**
     * Returns a rotated vector
     * @function
     * @param {Vector2} angle - Angle in radians
     * @param {Vector2} length - size of Vector2
     * @returns {Vector2} A new Vector2 instance
     * @instance
     * @static
     * @name fromRotation
     * @snippet Vector2.fromRotation|Vector2
        Vector2.fromRotation(${1:radians}, ${1:length})
     */
    Vector2.fromRotation = function (angle, length) {
        return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
    };

    /**
     * Returns a Vector2 instance pointing up
     * @returns {Vector2} A new Vector2 instance
     * @instance
     * @static
     * @name up
     * @snippet Vector2.up|Vector2
        Vector2.up()
     */
    Object.defineProperty(Vector2, 'up', {
        get: function () {
            return new Vector2(0, -1);
        }
    });
    /**
     * Returns a Vector2 instance pointing down
     * @returns {Vector2} A new Vector2 instance
     * @instance
     * @static
     * @name down
     * @snippet Vector2.down|Vector2
        Vector2.down()
     */
    Object.defineProperty(Vector2, 'down', {
        get: function () {
            return new Vector2(0, 1);
        }
    });
    /**
     * Returns a Vector2 instance pointing left
     * @returns {Vector2} A new Vector2 instance
     * @instance
     * @static
     * @name left
     * @snippet Vector2.left|Vector2
        Vector2.left()
     */
    Object.defineProperty(Vector2, 'left', {
        get: function () {
            return new Vector2(-1, 0);
        }
    });
    /**
     * Returns a Vector2 instance pointing right
     * @returns {Vector2} A new Vector2 instance
     * @instance
     * @static
     * @name right
     * @snippet Vector2.right|Vector2
        Vector2.right()
     */
    Object.defineProperty(Vector2, 'right', {
        get: function () {
            return new Vector2(1, 0);
        }
    });
    return Vector2;
});
/**
 * A helper module that returns an object with a correctly sized width and height for the aspect ratio
 * 'type' defines the allowed orientation
 * If the height goes over the max or minimum size, then the width gets adapted.
 * <br>Exports: Constructor
 * @module bento/autoresize
 * @moduleName AutoResize
 * @param {Number} minWidth - Lowest clamped width in portrait. Smaller than this, and height is scaled up to fit the aspect ratio. Acts as a 'target dimension'
 * @param {Number} maxWidth - Max clamped width in portrait.
 * @param {Number} minHeight - Lowest clamped height in portrait. . Smaller than this, and width is scaled up to fit the aspect ratio. Acts as a 'target dimension'
 * @param {Number} maxHeight - Max clamped height in portrait.
 * @param {String} lockedRotation - 'portrait' or 'landscape' - Enforces an aspect ratio for one or the other, not necessary if forcable by other means
 * @returns Object
 */
bento.define('bento/autoresize', [
    'bento/utils'
], function (Utils) {
    return function (minWidth, maxWidth, minHeight, maxHeight, lockedRotation) {
        var screenSize = Utils.getScreenSize();
        // get the ration of screen height to width 
        var ratio = screenSize.width / screenSize.height;
        // work out if we are currently in portrait or landscape
        var isPortrait = (ratio <= 1);

        //force a specific rotation
        switch (lockedRotation) {
        case 'portrait':
            isPortrait = true;
            break;
        case 'landscape':
            isPortrait = false;
            break;
        }

        // create new object with correctly scaled and clamped dimensions
        var newDimension = (isPortrait) ? {
            width: Math.ceil(Utils.clamp(minWidth, minHeight * ratio, maxWidth)),
            height: Math.ceil(Utils.clamp(minHeight, minWidth / ratio, maxHeight))
        } : {
            width: Math.ceil(Utils.clamp(minHeight, minWidth * ratio, maxHeight)),
            height: Math.ceil(Utils.clamp(minWidth, minHeight / ratio, maxWidth))
        };
        return newDimension;
    };
});
/**
 * An Entity that helps using a HTML5 2d canvas as Sprite. Its component temporarily takes over
 * the renderer, so any entity that gets attached to the parent will start drawing on the canvas.
 * <br>Exports: Constructor
 * @param {Object} settings - Required, set the width and height
 * @param {Number} settings.width - Width of the canvas (ignored if settings.canvas is set)
 * @param {Number} settings.height - Height of the canvas (ignored if settings.canvas is set)
 * @param {HTML-Canvas-Element} (settings.canvas) - Reference to an existing canvas object. Optional.
 * @param {Number} settings.preventAutoClear - Stops the canvas from clearing every tick
 * @param {Number} settings.pixelSize - size of a pixel (multiplies canvas size)
 * @module bento/canvas
 * @moduleName Canvas
 * @returns Entity
 * @snippet Canvas|constructor
Canvas({
    z: ${1:0},
    width: ${2:64},
    height: ${3:64},
    preventAutoClear: ${4:false}, // prevent canvas from clearing every tick
    pixelSize: ${5:1}, // multiplies internal canvas size
    drawOnce: ${6:false}, // draw canvas only once
    originRelative: new Vector2(${7:0}, ${8:0}),
    components: []
});
 */
bento.define('bento/canvas', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween',
    'bento/packedimage',
    'bento/objectpool',
    'bento/renderers/canvas2d'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    EventSystem,
    Utils,
    Tween,
    PackedImage,
    ObjectPool,
    Canvas2D
) {
    'use strict';
    var canvasPool = new ObjectPool({
        poolSize: 1,
        constructor: function () {
            var canvas = Bento.createCanvas();

            return canvas;
        },
        destructor: function (obj) {
            // clear canvas
            var context = obj.getContext('2d');
            context.clearRect(0, 0, obj.width, obj.height);
            // clear texture
            if (obj.texture) {
                if (obj.texture.destroy) {
                    obj.texture.destroy();
                }
                obj.texture = null;
            }
            return obj;
        }
    });
    return function (settings) {
        var viewport = Bento.getViewport();
        var i;
        var l;
        var sprite;
        var canvas;
        var context;
        var originalRenderer;
        var renderer;
        var packedImage;
        var origin = new Vector2(0, 0);
        var entity;
        var components;
        var drawn = false;
        // this component swaps the renderer with a Canvas2D renderer (see bento/renderers/canvas2d)
        var component = {
            name: 'rendererSwapper',
            draw: function (data) {
                // draw once
                if (drawn) {
                    return;
                }

                // clear up canvas
                if (!settings.preventAutoClear) {
                    context.clearRect(0, 0, canvas.width, canvas.height);
                }

                // clear up webgl
                if (canvas.texture) {
                    if (canvas.texture.destroy) {
                        canvas.texture.destroy();
                    }
                    canvas.texture = null;
                }

                // swap renderer
                originalRenderer = data.renderer;
                data.renderer = renderer;

                // re-apply the origin translation
                data.renderer.save();
                data.renderer.translate(Math.round(origin.x), Math.round(origin.y));
            },
            postDraw: function (data) {
                if (drawn) {
                    return;
                }
                data.renderer.restore();
                // swap back
                data.renderer = originalRenderer;

                // draw once
                if (settings.drawOnce) {
                    drawn = true;
                }
            }
        };

        // init canvas
        if (settings.canvas) {
            canvas = settings.canvas;
        } else {
            canvas = canvasPool.get();
            canvas.width = settings.width;
            canvas.height = settings.height;
        }
        context = canvas.getContext('2d');

        // init renderer
        renderer = new Canvas2D(canvas, {
            pixelSize: settings.pixelSize || 1
        });

        if (settings.origin) {
            origin = settings.origin;
        } else if (settings.originRelative) {
            origin = new Vector2(
                settings.width * settings.originRelative.x,
                settings.height * settings.originRelative.y
            );
        }

        // init sprite
        packedImage = new PackedImage(canvas);
        sprite = new Sprite({
            image: packedImage,
            origin: settings.origin,
            originRelative: settings.originRelative
        });

        // init entity and its components
        // sprite goes before the swapcomponent, otherwise the canvas will never be drawn
        components = [sprite, component];
        // attach any other component in settings
        if (settings.components) {
            for (i = 0, l = settings.components.length; i < l; ++i) {
                components.push(settings.components[i]);
            }
        }
        entity = new Entity({
            z: settings.z,
            name: settings.name || 'canvas',
            position: settings.position,
            components: components,
            family: settings.family,
            init: settings.init
        });

        // public interface
        entity.extend({
            /**
             * Returns the canvas element
             * @function
             * @instance
             * @returns HTML Canvas Element
             * @name getCanvas
             * @snippet #Canvas.getCanvas|CanvasElement
                getCanvas();
             */
            getCanvas: function () {
                return canvas;
            },
            /**
             * Returns the 2d context, to perform manual drawing operations
             * @function
             * @instance
             * @returns HTML Canvas 2d Context
             * @snippet #Canvas.getContext|Context2D
                getContext();
             * @name getContext
             */
            getContext: function () {
                return context;
            },
            /**
             * Get the base64 string of the canvas
             * @function
             * @instance
             * @returns String
             * @name getBase64
             * @snippet #Canvas.getBase64|String
                getBase64();
             */
            getBase64: function () {
                return canvas.toDataURL();
            },
            /**
             * Download the canvas as png (useful for debugging purposes)
             * @function
             * @instance
             * @name downloadImage
             * @snippet #Canvas.downloadImage|debug
                downloadImage();
             */
            downloadImage: function (name) {
                var link = document.createElement("a");
                link.download = name || entity.name;
                link.href = canvas.toDataURL();
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            },
            /**
             * Call this function if you have no intent on attaching the canvas,
             * but you do want to draw on the canvas once
             * @function
             * @instance
             * @name drawOnce
             * @snippet #Canvas.drawOnce|snippet
                drawOnce();
             */
            drawOnce: function (data) {
                if (canvas.isAdded) {
                    Utils.log('This Canvas is already attached, no need to call this function.');
                    return;
                }
                canvas.start(data);
                canvas.draw(data);
            }
        });

        return entity;
    };
});
/*
 * Returns a color array, for use in renderer
 * <br>Exports: Constructor
 * @param {Number} r - Red value [0...255]
 * @param {Number} g - Green value [0...255]
 * @param {Number} b - Blue value [0...255]
 * @param {Number} a - Alpha value [0...1]
 * @returns {Array} Returns a color array
 * @module bento/color
 * @module Color
 */
bento.define('bento/color', ['bento/utils'], function (Utils) {
    return function (r, g, b, a) {
        r = r / 255;
        r = g / 255;
        r = b / 255;
        if (!Utils.isDefined(a)) {
            a = 1;
        }
        return [r, g, b, a];
    };
});
/**
 * List of entities that spaces the items equally. Note: do not use attach()/remove(), but addItem() and removeItem().
 *
 * <br>Exports: Constructor
 * @moduleName CenteredList
 * @module bento/gui/centeredlist
 * @returns Entity
 * @snippet CenteredList|snippet
CenteredList({
    spacing: ${1:16}, // in pixels
    useItemDimensions: ${2:false}, // note: uses last item's dimension
    direction: '${3:x}',
    position: new Vector2(0, 0),
    items: []
})
 */
bento.define('bento/gui/centeredlist', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    EventSystem,
    Utils,
    Tween
) {
    'use strict';
    return function (settings) {
        var viewport = Bento.getViewport();
        var items = [];
        var spacing = settings.spacing || 8;
        var useItemDimensions = Utils.getDefault(settings.useItemDimensions, true);
        var direction = settings.direction || 'x';
        var dimension = direction === 'x' ? 'width' : 'height';
        var entitySettings = Utils.extend({
            z: 0,
            name: 'centeredList'
        }, settings, true);
        var entity = new Entity(entitySettings);
        var width = 0;
        var reposition = function () {
            var i = 0;
            var totalWidth = (width + spacing) * (items.length - 1);
            var item;
            for (i = 0; i < items.length; ++i) {
                item = items[i];
                item.position[direction] = -totalWidth / 2 + (width + spacing) * i;
            }
        };
        var addItem = function (item) {
            if (useItemDimensions) {
                // note: always uses the last item dimension
                width = item.dimension[dimension];
            }
            items.push(item);
            entity.attach(item);
            reposition();
            return item;
        };

        entity.extend({
            /*
             * Adds an item to the list
             * @instance
             * @function
             * @name addItem
             * @snippet #CenteredList.addItem|snippet
                addItem(${1:item})
             */
            addItem: addItem,
            /**
             * Remove item by index
             * @instance
             * @function
             * @name removeItem
             * @snippet #CenteredList.removeItem|snippet
                removeItem(${1:index})
             */
            removeItem: function (index) {
                var item = items.splice(index, 1);
                entity.remove(item);
                reposition();
            },
            /**
             * Iterate through items
             * @instance
             * @function
             * @name iterate
             * @snippet #CenteredList.iterate|snippet
iterate(function (item, i, l, breakLoop) {
    $1
})
             */
            iterate: function (callback) {
                var i, l;
                var stop = false;
                var breakLoop = function () {
                    stop = true;
                };
                for (i = 0, l = items.length; i < l; ++i) {
                    callback(items[i], i, l, breakLoop);

                    if (stop) {
                        return;
                    }
                }
            },
            /**
             * Get item by index
             * @instance
             * @function
             * @name get
             * @snippet #CenteredList.get|Object
                get(${1:index})
             */
            get: function (index) {
                return items[index];
            },
            /**
             * Removes all items
             * @instance
             * @function
             * @name clear
             * @snippet #CenteredList.clear|snippet
                clear()
             */
            clear: function () {
                var ii;
                for (ii = items.length - 1; ii >= 0; ii--) {
                    entity.remove(items[ii]);
                }
                reposition();
                items = [];
            },
            /**
             * Get index of an item
             * @instance
             * @function
             * @name getIndex
             * @snippet #CenteredList.getIndex|Number
                getIndex()
             */
            getIndex: function (item) {
                return items.indexOf(item);
            }
        });

        /**
         * Length property
         * @instance
         * @function
         * @name length
         * @snippet #CenteredList.length|Number
            length
         */
        Object.defineProperty(entity, 'length', {
            get: function () {
                return items.length;
            },
            set: function (value) {
                items.length = value;
            }
        });


        if (settings.items) {
            Utils.forEach(settings.items, function (item, i, l, breakLoop) {
                entity.addItem(item);
            });
        }

        return entity;
    };
});
/**
 * An entity that behaves like a click button.
 * <br>Exports: Constructor
 * @param {Object} settings - Required, can include Entity settings
 * @param {Sprite} settings.sprite - Sprite component. The sprite should have an "up", "down" and an "inactive" animation. Alternatively, you can pass all Sprite settings. Then, by default "up" and "down" are assumed to be frames 0 and 1 respectively. Frame 3 is assumed to be "inactive", if it exists
 * @param {Function} settings.onClick - Callback when user clicks on the button ("this" refers to the clickbutton entity). Alternatively, you can listen to a "clickButton" event, the entity is passed as parameter.
 * @param {Bool} settings.active - Whether the button starts in the active state (default: true)
 * @param {String} [settings.sfx] - Plays sound when pressed
 * @param {Function} [settings.onButtonDown] - When the user holds the mouse or touches the button
 * @param {Function} [settings.onButtonUp] - When the user releases the mouse or stops touching the button
 * @param {Boolean} [settings.sort] - Callbacks are executed first if the component/entity is visually on top. Other ClickButtons must also have "sort" to true.
 * @module bento/gui/clickbutton
 * @moduleName ClickButton
 * @returns Entity
 * @snippet ClickButton|constructor
ClickButton({
    z: ${1:0},
    name: '$2',
    sfx: '$3',
    imageName: '$4',
    frameCountX: ${5:1},
    frameCountY: ${6:3},
    position: new Vector2(${7:0}, ${8:0}),
    updateWhenPaused: ${9:0},
    float: ${10:false},
    onButtonDown: function () {},
    onButtonUp: function () {},
    onClick: function () {
        $11
    }
});
 */
bento.define('bento/gui/clickbutton', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/nineslice',
    'bento/components/clickable',
    'bento/entity',
    'bento/utils',
    'bento/tween',
    'bento/eventsystem'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    NineSlice,
    Clickable,
    Entity,
    Utils,
    Tween,
    EventSystem
) {
    'use strict';
    var ClickButton = function (settings) {
        var viewport = Bento.getViewport();
        var active = true;
        var defaultAnimations = {
            'up': {
                speed: 0,
                frames: [0]
            },
            'down': {
                speed: 0,
                frames: [1]
            },
            'inactive': {
                speed: 0,
                frames: [2]
            }
        };
        if (settings.frameCountX * settings.frameCountY <= 2) {
            defaultAnimations.inactive.frames = [0];
        }
        if (settings.frameCountX * settings.frameCountY <= 1) {
            defaultAnimations.down.frames = [0];
        }
        var animations = settings.animations || defaultAnimations;
        var nsSettings = settings.nineSliceSettings || null;
        var nineSlice = !nsSettings ? null : new NineSlice({
            image: settings.image,
            imageName: settings.imageName,
            originRelative: settings.originRelative || new Vector2(0.5, 0.5),
            frameWidth: settings.frameWidth,
            frameHeight: settings.frameHeight,
            frameCountX: settings.frameCountX,
            frameCountY: settings.frameCountY,
            width: nsSettings.width,
            height: nsSettings.height,
            animations: animations
        });
        var sprite = nineSlice ? null : settings.sprite || new Sprite({
            image: settings.image,
            imageName: settings.imageName,
            originRelative: settings.originRelative || new Vector2(0.5, 0.5),
            padding: settings.padding,
            frameWidth: settings.frameWidth,
            frameHeight: settings.frameHeight,
            frameCountX: settings.frameCountX,
            frameCountY: settings.frameCountY,
            animations: animations
        });
        var visualComponent = nineSlice || sprite;
        // workaround for pointerUp/onHoldEnd order of events
        var wasHoldingThis = false;
        var clickable = new Clickable({
            sort: settings.sort,
            ignorePauseDuringPointerUpEvent: settings.ignorePauseDuringPointerUpEvent,
            onClick: function (data) {
                wasHoldingThis = false;
                if (!active || ClickButton.currentlyPressing) {
                    return;
                }
                ClickButton.currentlyPressing = entity;
                setAnimation('down');
                if (settings.onButtonDown) {
                    settings.onButtonDown.apply(entity, [data]);
                }
                EventSystem.fire('clickButton-onButtonDown', {
                    entity: entity,
                    event: 'onClick',
                    data: data
                });
            },
            onHoldEnter: function (data) {
                if (!active) {
                    return;
                }
                setAnimation('down');
                if (settings.onButtonDown) {
                    settings.onButtonDown.apply(entity, [data]);
                }
                EventSystem.fire('clickButton-onButtonDown', {
                    entity: entity,
                    event: 'onHoldEnter',
                    data: data
                });
            },
            onHoldLeave: function (data) {
                if (!active) {
                    return;
                }
                setAnimation('up');
                if (settings.onButtonUp) {
                    settings.onButtonUp.apply(entity, [data]);
                }
                EventSystem.fire('clickButton-onButtonUp', {
                    entity: entity,
                    event: 'onHoldLeave',
                    data: data
                });
            },
            pointerUp: function (data) {
                if (!active) {
                    return;
                }
                setAnimation('up');
                if (settings.onButtonUp) {
                    settings.onButtonUp.apply(entity, [data]);
                }
                EventSystem.fire('clickButton-onButtonUp', {
                    entity: entity,
                    event: 'pointerUp',
                    data: data
                });
                if (ClickButton.currentlyPressing === entity) {
                    wasHoldingThis = true;
                    ClickButton.currentlyPressing = null;
                }
            },
            onHoldEnd: function (data) {
                if (active && settings.onClick && (ClickButton.currentlyPressing === entity || wasHoldingThis)) {
                    wasHoldingThis = false;
                    settings.onClick.apply(entity, [data]);
                    if (settings.sfx) {
                        Bento.audio.stopSound(settings.sfx);
                        Bento.audio.playSound(settings.sfx);
                    }
                    EventSystem.fire('clickButton-onClick', {
                        entity: entity,
                        event: 'onHoldEnd',
                        data: data
                    });
                }
                if (ClickButton.currentlyPressing === entity) {
                    ClickButton.currentlyPressing = null;
                }
            },
            onClickMiss: function (data) {
                if (settings.onClickMiss) {
                    settings.onClickMiss(data);
                }
            }
        });
        var entitySettings = Utils.extend({
            z: 0,
            name: 'clickButton',
            position: new Vector2(0, 0),
            family: ['buttons'],
            init: function () {
                setActive(active);
            }
        }, settings, true);

        // merge components array
        entitySettings.components = [
            visualComponent,
            clickable
        ].concat(settings.components || []);

        var setActive = function (bool) {
            active = bool;

            animations = visualComponent.animations || animations;

            if (!active) {
                if (ClickButton.currentlyPressing === entity) {
                    ClickButton.currentlyPressing = null;
                }
                if (animations.inactive) {
                    setAnimation('inactive');
                } else {
                    setAnimation('up');
                }
            } else {
                setAnimation('up');
            }
        };

        var setAnimation = function (animation) {
            visualComponent.setAnimation(animation);
        };

        var entity = new Entity(entitySettings).extend({
            /**
             * Activates or deactives the button. Deactivated buttons cannot be pressed.
             * @function
             * @param {Bool} active - Should be active or not
             * @instance
             * @name setActive
             * @snippet #ClickButton.setActive|snippet
            setActive(${1:true});
             */
            setActive: setActive,
            /**
             * Performs the callback as if the button was clicked
             * @function
             * @instance
             * @name doCallback
             * @snippet #ClickButton.doCallback|snippet
            doCallback();
             */
            doCallback: function () {
                settings.onClick.apply(entity);
            },
            /**
             * Performs the callback as if the button was clicked, 
             * takes active state into account 
             * @function
             * @instance
             * @name mimicClick
             * @snippet #ClickButton.mimicClick|snippet
                mimicClick();
             */
            mimicClick: function () {
                if (active) {
                    wasHoldingThis = true;
                    clickable.callbacks.onHoldEnd({});
                    // settings.onClick.apply(entity);
                }
            },
            /**
             * Check if the button is active
             * @function
             * @instance
             * @name isActive
             * @returns {Bool} Whether the button is active
             * @snippet #ClickButton.isActive|Boolean
            isActive(${1:true});
             */
            isActive: function () {
                return active;
            },
            /**
             * Set the size of the clickbutton if it's using a nine slice
             * @function
             * @param {Number} width
             * @param {Number} height
             * @instance
             * @name setNineSliceSize
             */
            setNineSliceSize: function (width, height) {
                if (visualComponent.name !== 'nineslice') {
                    console.warn("LK_WARN: Don't use setNineSliceSize if the clickbutton uses a sprite.");
                    return;
                }
                nsSettings.width = width;
                nsSettings.height = height;
                visualComponent.width = width;
                visualComponent.height = height;
            }
        });

        if (Utils.isDefined(settings.active)) {
            active = settings.active;
        }

        // events for the button becoming active
        entity.attach({
            name: 'attachComponent',
            start: function () {
                EventSystem.fire('clickButton-start', {
                    entity: entity
                });
            },
            destroy: function () {
                EventSystem.fire('clickButton-destroy', {
                    entity: entity
                });
                if (ClickButton.currentlyPressing === entity) {
                    ClickButton.currentlyPressing = null;
                }
            }
        });

        /**
         * Active property
         * @instance
         * @function
         * @name active
         */
        Object.defineProperty(entity, 'active', {
            get: function () {
                return active;
            },
            set: setActive
        });

        return entity;
    };

    ClickButton.currentlyPressing = null;

    return ClickButton;
});
/**
 * An entity that behaves like a counter.
 * <br>Exports: Constructor
 * @module bento/gui/counter
 * @moduleName Counter
 * @returns Entity
 * @snippet Counter|constructor
Counter({
    z: ${1:0},
    name: '$2',
    value: ${3:0},
    imageName: '$4',
    frameCountX: ${5:1},
    frameCountY: ${6:10},
    padding: ${7:0},
    align: '${8:center}',
    spacing: new Vector2(${9:0}, ${10:0}),
    position: new Vector2(${11:0}, ${12:0}),
    updateWhenPaused: ${13:0},
    float: ${14:false},
});
 * @snippet Counter|animations
Counter({
    z: ${1:0},
    name: '$2',
    value: ${3:0},
    imageName: '$4',
    frameCountX: ${5:1},
    frameCountY: ${6:10},
    animations: {
        '0': {
            frames: [0]
        },
        '1': {
            frames: [1]
        },
        '2': {
            frames: [2]
        },
        '3': {
            frames: [3]
        },
        '4': {
            frames: [4]
        },
        '5': {
            frames: [5]
        },
        '6': {
            frames: [6]
        },
        '7': {
            frames: [7]
        },
        '8': {
            frames: [8]
        },
        '9': {
            frames: [9]
        }
    },
    padding: ${7:0},
    align: '${8:center}',
    spacing: new Vector2(${9:0}, ${10:0}),
    position: new Vector2(${11:0}, ${12:0}),
    updateWhenPaused: ${13:0},
    float: ${14:false},
});
 */
bento.define('bento/gui/counter', [
    'bento',
    'bento/entity',
    'bento/math/vector2',
    'bento/components/sprite',
    'bento/utils'
], function (
    Bento,
    Entity,
    Vector2,
    Sprite,
    Utils
) {
    'use strict';
    return function (settings) {
        /*{
            value: Number,
            spacing: Vector,
            align: String,
            image: Image, // lower priority
            frameWidth: Number, // lower priority
            frameHeight: Number, // lower priority
            animations: Object, // only way to overwrite animations
            sprite: Sprite({
                image: Image,
                imageName: String,
                frameWidth: Number,
                frameHeight: Number,
                animations: Animation
            }),
            position: Vector
        }*/
        var value = settings.value || 0;
        var spacing = settings.spacing || new Vector2(0, 0);
        var alignment = settings.align || settings.alignment || 'right';
        var digitWidth = 0;
        var children = [];
        var spriteSettings = {};
        /*
         * Counts the number of digits in the value
         */
        var getDigits = function () {
            return value.toString().length;
        };
        /*
         * Returns an entity with all digits as animation
         */
        var createDigit = function () {
            var defaultNumbers = {
                '0': {
                    frames: [0]
                },
                '1': {
                    frames: [1]
                },
                '2': {
                    frames: [2]
                },
                '3': {
                    frames: [3]
                },
                '4': {
                    frames: [4]
                },
                '5': {
                    frames: [5]
                },
                '6': {
                    frames: [6]
                },
                '7': {
                    frames: [7]
                },
                '8': {
                    frames: [8]
                },
                '9': {
                    frames: [9]
                }
                // TODO: add a '-' as default or not?
                // '-': {
                //     frames: [10]
                // }
            };
            var sprite = new Sprite({
                image: spriteSettings.image,
                padding: spriteSettings.padding,
                imageName: spriteSettings.imageName,
                frameWidth: spriteSettings.frameWidth,
                frameHeight: spriteSettings.frameHeight,
                frameCountX: spriteSettings.frameCountX,
                frameCountY: spriteSettings.frameCountY,
                animations: settings.animations || defaultNumbers
            });
            // settings.digit can be used to change every digit entity constructor
            var digitSettings = Utils.extend({
                name: 'digit',
                components: [sprite]
            }, settings.digit || {});
            var entity = new Entity(digitSettings);

            // update width
            digitWidth = sprite.frameWidth;

            return entity;
        };
        /*
         * Adds or removes children depending on the value
         * and number of current digits and updates
         * the visualuzation of the digits
         */
        var updateDigits = function () {
            // add or remove digits
            var i, l,
                valueStr = value.toString(),
                pos,
                digit,
                digits = getDigits(),
                difference = children.length - digits;
            /* update number of children to be
                    the same as number of digits*/
            if (difference < 0) {
                // create new
                for (i = 0; i < Math.abs(difference); ++i) {
                    digit = createDigit();
                    children.push(digit);
                    container.attach(digit);

                }
            } else if (difference > 0) {
                // remove
                for (i = 0; i < Math.abs(difference); ++i) {
                    digit = children.pop();
                    container.remove(digit);
                }
            }
            /* update animations */
            for (i = 0, l = children.length; i < l; ++i) {
                digit = children[i];
                digit.position = new Vector2((digitWidth + spacing.x) * i, 0);
                digit.getComponent('sprite', function (sprite) {
                    sprite.setAnimation(valueStr.substr(i, 1));
                });
            }

            /* alignment */
            if (alignment === 'right') {
                // move all the children
                for (i = 0, l = children.length; i < l; ++i) {
                    digit = children[i];
                    pos = digit.position;
                    pos.substractFrom(new Vector2((digitWidth + spacing.x) * digits - spacing.x, 0));
                }
            } else if (alignment === 'center') {
                for (i = 0, l = children.length; i < l; ++i) {
                    digit = children[i];
                    pos = digit.position;
                    pos.addTo(new Vector2(((digitWidth + spacing.x) * digits - spacing.x) / -2, 0));
                }
            }
        };
        var entitySettings = {
            z: settings.z,
            name: settings.name || 'counter',
            position: settings.position
        };
        var container;

        // copy spritesettings
        spriteSettings.image = settings.image;
        spriteSettings.imageName = settings.imageName;
        spriteSettings.padding = settings.padding;
        spriteSettings.frameWidth = settings.frameWidth;
        spriteSettings.frameHeight = settings.frameHeight;
        spriteSettings.frameCountX = settings.frameCountX;
        spriteSettings.frameCountY = settings.frameCountY;
        // can also use a predetermined sprite as base for every
        if (settings.sprite) {
            settings.sprite = settings.sprite.animationSettings;
            spriteSettings.image = settings.sprite.image;
            spriteSettings.imageName = settings.sprite.imageName;
            spriteSettings.padding = settings.sprite.padding;
            spriteSettings.frameWidth = settings.sprite.frameWidth;
            spriteSettings.frameHeight = settings.sprite.frameHeight;
            spriteSettings.frameCountX = settings.sprite.frameCountX;
            spriteSettings.frameCountY = settings.sprite.frameCountY;
        }

        Utils.extend(entitySettings, settings);
        // merge components array
        entitySettings.components = settings.components;
        /*
         * Public interface
         */
        container = new Entity(entitySettings).extend({
            /*
             * Sets current value
             * @snippet #Counter.setValue|snippet
                setValue(${1:0});
             */
            setValue: function (val) {
                value = val;
                updateDigits();
            },
            /*
             * Retrieves current value
             * @snippet #Counter.getValue|Number
                getValue();
             */
            getValue: function () {
                return value;
            },
            /*
             * Add value
             * @snippet #Counter.addValue|snippet
                addValue(${1:0});
             */
            addValue: function (val) {
                value += val;
                updateDigits();
            },
            /*
             * Get number of digits
             * @snippet #Counter.getDigits|Number
                getDigits();
             */
            getDigits: function () {
                return getDigits();
            },
            /*
             * Loop through digits
             * @snippet #Counter.loopDigits|snippet
                loopDigits(function (digitEntity) {$1});
             */
            loopDigits: function (callback) {
                var i = 0, l;
                for (i = 0, l = children.length; i < l; ++i) {
                    callback(children[i]);
                }
            }
        });

        updateDigits();

        return container;
    };
});
/**
 * Scrolling list of items, designed for touch input. Note: do not use attach()/remove(), but addItem() and removeItem().
 * <br>Exports: Constructor
 * @moduleName ScrollingList
 * @module bento/gui/scrollinglist
 * @returns Entity
 * @snippet ScrollingList|constructor
ScrollingList({
    z: 0,
    position: new Vector2(0, 0),
    updateWhenPaused: 0,
    area: new Rectangle(0, 0, 0, 0), // area that user can grab
    direction: 'x', // 'x' or 'y'
    spacing: 0, // additional spacing between items
    maxOffset: 0, // additional max scrolling distance
    minOffset: 0, // additional min scrolling distance
    snap: false, // snap items (cancels maxOffset and minOffset)
    snapNextOffset: 0, // distance to scroll to snap to next, in screen pixels. Used with snap:true, best with damping:0
    onSnap: function (item, index) {}, // called when snap focus changed
    onLoseFocus: function (index) {}, // called when snap focus changed
    onScrollStart: function () {}, // callback when scrolling has started
    snapMinSlideSpeed: 1, // minimum slidespeed before starting to snap
    snapSpeed: 0.3, // speed of snapping
    damping: 0.9 // speed decrease,
});
 */
bento.define('bento/gui/scrollinglist', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    EventSystem,
    Utils,
    Tween
) {
    'use strict';
    return function (settings) {
        /*settings = {
            z: Number
            position: Vector2
            updateWhenPaused: Boolean
            subPixel: Boolean
            area: Rectangle // area that user can grab
            direction: String // 'x' or 'y'
            spacing: Number // additional spacing between items
            maxOffset: Number // additional max scrolling distance
            minOffset: Number // additional min scrolling distance
            snap: Boolean // snap items (cancels maxOffset and minOffset)
            onSnap: Function // called when snap focus changed
            onLoseFocus: Function // called when snap focus changed
            onScrollStart: Function // callback when scrolling has started
            snapMinSlideSpeed: Number // minimum slidespeed before starting to snap
            snapSpeed: Number // speed of snapping
            damping: Number // speed decrease,
        }*/
        var viewport = Bento.getViewport();
        var items = [];

        // scroll variables
        var originalPos = 0;
        var holdPos = 0;
        var grabX = 0;
        var diffX = 0;
        var isHolding = null;
        var speedX = 0;
        var avgSpeedX = 0;
        var slideSpeed = 0;
        var selectionBeforeHold = 0;
        var previousSelection = 0;
        var currentSelection = 0;
        var release = false;
        var dir = settings.direction || 'y'; // 'x' or 'y'
        var dim = (dir === 'x' ? 'width' : 'height');
        var otherDim = (dir === 'x' ? 'height' : 'width');
        var spacing = settings.spacing || 0;
        var snap = settings.snap || false;
        var snapNextOffset = settings.snapNextOffset || 0;
        var maxOffset = snap ? 0 : settings.maxOffset || 0; // snap and extra offset doesn't make sense
        var minOffset = snap ? 0 : settings.minOffset || 0;
        var clamp = settings.clamp || false;
        var snapMinSlideSpeed = settings.snapMinSlideSpeed || 1;
        var snapSpeed = settings.snapSpeed || 0.3;
        var damping = settings.damping || 0.9;
        var forcedSnap = -1;
        var totalSize = 0;
        var itemWidth = 0;
        var previousPos = 0;
        var currentPos = 0;
        var active = true;
        // components
        var clickable = new Clickable({
            pointerDown: function (evt) {
                if (!active) {
                    return;
                }
                if (isHolding !== null) {
                    // already scrolling
                    return;
                }
                var y = container.position[dir];
                grabX = evt.position[dir];

                holdPos = evt.position[dir];
                originalPos = container.position[dir];
                selectionBeforeHold = currentSelection;
                // TEMP don't scroll if only 1 item (there should be a nicer solution for this)
                if (items.length <= 1) {
                    return;
                }
                if (settings.area) {
                    if (settings.area.hasPosition(evt.localPosition)) {
                        isHolding = evt.id;
                        if (settings.onScrollStart) {
                            settings.onScrollStart();
                        }
                    }
                } else {
                    isHolding = evt.id;
                    if (settings.onScrollStart) {
                        settings.onScrollStart();
                    }
                }
                // if (evt.position.y > 48 && evt.position.y < viewport.height - 64) {
                //     isHolding = true;
                // }
            },
            pointerMove: function (evt) {
                if (isHolding === evt.id) {
                    // measure speed
                    speedX = evt.position[dir] - grabX;
                    if (Math.abs(speedX) > Math.abs(avgSpeedX)) {
                        avgSpeedX = speedX;
                    }
                    diffX = evt.position[dir] - grabX;
                    // container.position[dir] += diffX;
                    container.position[dir] = originalPos + (evt.position[dir] - holdPos);
                    grabX = evt.position[dir];
                    if (settings.onScroll) {
                        settings.onScroll(container.position[dir]);
                    }
                }
            },
            pointerUp: function (evt) {
                var diff;
                if (isHolding === evt.id) {
                    isHolding = null;
                    slideSpeed = avgSpeedX;

                    // snap to next with snapNextOffset
                    diff = holdPos - evt.position[dir];
                    if (snap && snapNextOffset) {
                        if (diff > snapNextOffset) {
                            entity.snapTo(selectionBeforeHold + 1);
                        } else if (diff < -snapNextOffset) {
                            entity.snapTo(selectionBeforeHold - 1);
                        }
                    }
                }
            }
        });
        var behavior = {
            pointers: [],
            start: function () {
                this.pointers = Bento.input.getPointers();
            },
            update: function () {
                if (isHolding !== null && this.pointers.length === 0) {
                    // missed a pointerUp somehow
                    isHolding = null;
                }
            }
        };
        // item container
        var scrollBehavior = {
            name: 'scrollBehavior',
            update: function () {
                var // diff position
                    containerX = container.position[dir],
                    //
                    size = (itemWidth + spacing),
                    maxSel = items.length - 1,
                    minSel = 0,
                    selection = Utils.clamp(-maxSel, size === 0 ? 0 : Math.round(containerX / size), minSel),
                    index,
                    // focus
                    target = selection * size;

                if (release) {
                    release = false;
                    isHolding = null;
                    slideSpeed = 0;
                    return;
                }

                if (previousSelection !== selection) {
                    if (settings.onLoseFocus) {
                        settings.onLoseFocus(items[Utils.clamp(0, -previousSelection, items.length - 1)]);
                    }
                    previousSelection = selection;
                    currentSelection = -selection;
                    if (settings.onSnap) {
                        index = Utils.clamp(0, currentSelection, items.length - 1);
                        settings.onSnap(items[index], index);
                    }
                }

                // force snap
                if (forcedSnap >= 0 && selection !== -forcedSnap) {
                    target = -forcedSnap * size;
                } else {
                    forcedSnap = -1;
                }

                avgSpeedX = avgSpeedX * 0.6;

                if (isHolding === null) {
                    // snap
                    if (snap) {
                        if (Math.abs(slideSpeed) < snapMinSlideSpeed) {
                            container.position[dir] += (target - containerX) * snapSpeed;
                        } else {
                            container.position[dir] += slideSpeed;
                        }
                    }

                    // move
                    container.position[dir] += slideSpeed;

                    // limits
                    if (containerX <= -totalSize - maxOffset) {
                        target = -totalSize - maxOffset;
                        container.position[dir] += (target - containerX) * 0.1;
                        slideSpeed /= 2;
                    } else if (containerX > minOffset) {
                        target = minOffset;
                        container.position[dir] += (target - containerX) * 0.1;
                        slideSpeed /= 2;
                    }
                }

                // set item positions, because they can change due to expanding/collapsing
                setItemPos();

                // damping
                if (Math.abs(slideSpeed) < 2) {
                    slideSpeed *= damping;
                } else {
                    slideSpeed *= damping;
                }

                if (clamp) {
                    if (container.position[dir] > minOffset) {
                        container.position[dir] = minOffset;
                        slideSpeed = 0;
                    } else if (container.position[dir] <= -totalSize - maxOffset) {
                        container.position[dir] = -totalSize - maxOffset;
                        slideSpeed = 0;
                    }
                }

                currentPos = container.position[dir];
            }
        };
        var container = new Entity({
            name: 'container',
            updateWhenPaused: settings.updateWhenPaused || 0,
            components: []
        });
        // main entity
        var entitySettings = Utils.extend({
            z: 0,
            name: 'scrollingList'
        }, settings, true);
        // merge components array
        entitySettings.components = [
            clickable,
            container,
            scrollBehavior,
            behavior
        ].concat(settings.components || []);

        var entity = new Entity(entitySettings);
        var setItemPos = function () {
            var i, l,
                item,
                size = 0;

            totalSize = 0;
            for (i = 0, l = items.length; i < l; ++i) {
                item = items[i];
                item.position[dir] = size;
                if (i !== l - 1) { // don't count last part
                    itemWidth = item.dimension[dim];
                    size += itemWidth + spacing;
                }

            }
            totalSize = size;
        };

        // public
        entity.extend({
            /**
             * Adds an item to the list
             * @instance
             * @function
             * @name addItem
             * @snippet #ScrollingList.addItem|snippet
                addItem(${1:item})
             */
            addItem: function (item) {
                // item.position[dir] = (item.dimension[dim] + spacing) * items.length;
                items.push(item);
                container.attach(item);
                setItemPos();
                return entity;
            },
            /**
             * Remove item by index and returns the removed item
             * @instance
             * @function
             * @name removeItem
             * @snippet #ScrollingList.removeItem|Entity
                removeItem(${1:index})
             */
            removeItem: function (index) {
                var item = items.splice(index, 1);
                container.remove(item[0]);
                setItemPos();
                return item;
            },
            /**
             * Did list move within tolerance?
             * Useful for the onClick callback in ClickButton if they reside in a ScrollingList.
             * @instance
             * @function
             * @name didMove
             * @snippet #ScrollingList.didMove|Number
                didMove(${1:tolerance})
             */
            didMove: function (tolerance) {
                return Math.abs(currentPos - originalPos) > tolerance;
            },
            /**
             * Iterate through items
             * @instance
             * @function
             * @name iterate
             * @snippet #ScrollingList.iterate|snippet
iterate(function (item, i, l, breakLoop) {
    $1
})
             */
            iterate: function (callback) {
                var i = 0;
                var l = items.length;
                var stop = false;
                var breakLoop = function () {
                    stop = true;
                };
                for (i = 0; i < l; ++i) {
                    callback(items[i], i, l, breakLoop);
                    if (stop) {
                        return;
                    }
                }
            },
            /**
             * Force scrolling position
             * @instance
             * @function
             * @name forceTo
             * @snippet #ScrollingList.forceTo|snippet
                forceTo(${1:scrollPosition})
             */
            forceTo: function (value) {
                container.position[dir] = value;
                entity.update();
            },
            /**
             * Get scrolling position
             * @instance
             * @function
             * @name getScroll
             * @snippet #ScrollingList.getScroll|snippet
                getScroll()
             */
            getScroll: function () {
                return container.position[dir];
            },
            /**
             * Get item by index
             * @instance
             * @function
             * @name get
             * @snippet #ScrollingList.get|Object
                get(${1:index})
             */
            get: function (index) {
                return items[index];
            },
            /**
             * Retrieve array of all items (reference)
             * @instance
             * @function
             * @name getItems
             * @snippet #ScrollingList.getItems|Array
                getItems()
             */
            getItems: function () {
                return items;
            },
            /**
             * Retrieve total width/height of all items
             * @instance
             * @function
             * @name getTotalSize
             * @snippet #ScrollingList.getTotalSize|Number
                getTotalSize()
             */
            getTotalSize: function () {
                return totalSize;
            },
            /**
             * Sets area in which the touch input is active (area in local coordinates)
             * @instance
             * @function
             * @name setArea
             * @snippet #ScrollingList.setArea|snippet
                setArea(${1:rectangle})
             */
            setArea: function (area) {
                settings.area = area;
            },
            /**
             * Snap to index (snap setting must be true)
             * @instance
             * @function
             * @name snapTo
             * @snippet #ScrollingList.snapTo|snippet
                snapTo(${1:index})
             */
            snapTo: function (index) {
                forcedSnap = Utils.clamp(0, index, items.length - 1);
            },
            /**
             * Get "selection", the index that is currently at the center of scrolling
             * @instance
             * @function
             * @name getSelection
             * @snippet #ScrollingList.getSelection|Number
                getSelection()
             */
            getSelection: function () {
                return currentSelection;
            },
            /**
             * Cancel any scrolling immediately 
             * @instance
             * @function
             * @name cancel
             * @snippet #ScrollingList.cancel|snippet
                cancel()
             */
            cancel: function () {
                release = true;
            },
            /**
             * Is currently scrolling/moving?
             * @instance
             * @function
             * @name isScrolling
             * @snippet #ScrollingList.isScrolling|Boolean
                isScrolling()
             */
            isScrolling: function () {
                return Math.abs(slideSpeed) > 0.2;
            },
            /**
             * Set minimum value that can be scrolled to
             * @instance
             * @function
             * @name setMinOffset
             * @snippet #ScrollingList.setMinOffset|snippet
                setMinOffset(${1:pixels})
             */
            setMinOffset: function (value) {
                minOffset = value;
            },
            /**
             * Set maximum value that can be scrolled to
             * @instance
             * @function
             * @name setMaxOffset
             * @snippet #ScrollingList.setMaxOffset|snippet
                setMaxOffset(${1:pixels})
             */
            setMaxOffset: function (value) {
                maxOffset = value;
            },
            /**
             * Set spacing between items
             * @instance
             * @function
             * @name setSpacing
             * @snippet #ScrollingList.setSpacing|snippet
                setSpacing(${1:pixels})
             */
            setSpacing: function (size) {
                spacing = size;
                setItemPos();
            },
            /**
             * Stop sliding immediately
             * @instance
             * @function
             * @name stopSliding
             * @snippet #ScrollingList.stopSliding|snippet
                stopSliding()
             */
            stopSliding: function () {
                slideSpeed = 0;
            },
            /**
             * Set active (alternatively, set the active property)
             * @instance
             * @function
             * @name setActive
             * @snippet #ScrollingList.setActive|snippet
                setActive(${1:boolean})
             */
            setActive: function (value) {
                active = value;
            }
        });

        /**
         * Length property
         * @instance
         * @function
         * @name length
         * @snippet #ScrollingList.length|Number
            length
         */
        Object.defineProperty(entity, 'length', {
            get: function () {
                return items.length;
            },
            set: function (value) {
                items.length = value;
            }
        });

        /**
         * Active property
         * @instance
         * @function
         * @name active
         * @snippet #ScrollingList.active|Number
            active
         */
        Object.defineProperty(entity, 'active', {
            get: function () {
                return active;
            },
            set: entity.setActive
        });

        return entity;
    };
});
/**
 * An entity that displays text from a system font or ttf font. Be warned: drawing text is an expensive operation.
 * This module caches the drawn text as a speed boost, however if you are updating the text all the time this
 * speed boost is cancelled.
 * <br>Exports: Constructor
 * @param {Object} settings - Required, can include Entity settings
 * @param {String} settings.text - String to set as text
 * @param {String} settings.font - Name of the font
 * @param {Number} [settings.fontSize] - Font size in pixels
 * @param {String} [settings.fontColor] - Color of the text (CSS color specification)
 * @param {String} [settings.align] - Alignment: left, center, right (also sets the origin)
 * @param {String} [settings.textBaseline] - Text baseline: bottom, middle, top (also sets the origin)
 * @param {Vector2} [settings.margin] - Expands the canvas (only useful for fonts that have letters that are too large to draw)
 * @param {Number} [settings.ySpacing] - Additional vertical spacing between line breaks
 * @param {Number} [settings.sharpness] - In Chrome the text can become blurry when centered. As a workaround, sharpness acts as extra scale (1 for normal, defaults to 4)
 * @param {Number/Array} [settings.lineWidth] - Line widths (must be set when using strokes), can stroke multiple times
 * @param {String/Array} [settings.strokeStyle] - CSS stroke style
 * @param {Bool/Array} [settings.innerStroke] - Whether the particular stroke should be inside the text
 * @param {Bool} [settings.pixelStroke] - Cocoon.io's canvas+ has a bug with text strokes. This is a workaround that draws a stroke by drawing the text multiple times.
 * @param {Bool} [settings.antiAlias] - Set anti aliasing on text (Cocoon only)
 * @param {Boolean} [settings.shadow] - Draws a shadow under the text
 * @param {Vector2} [settings.shadowOffset] - Offset of shadow
 * @param {String} [settings.shadowColor] - Color of the shadow (CSS color specification)
 * @param {Number} [settings.maxWidth] - Maximum width for the text. If the the text goes over this, it will first start adding linebreaks. If that doesn't help it will start scaling ifself down. Use null to reset maxWidth.
 * @param {Number} [settings.maxHeight] - Maximum height for the text. If the the text goes over this, it will start scaling itself down. Use null to reset maxHeight.
 * @param {Number} [settings.linebreaks] - Allow the module to add linebreaks to fit text with maxWidth (default true)
 * @param {Boolean} [settings.drawDebug] - Draws the maxWidth and maxHeight as a box. Also available as static value Text.drawDebug, affecting every Text object.
 * @module bento/gui/text
 * @moduleName Text
 * @snippet Text|constructor
Text({
    z: ${1:0},
    position: new Vector2(${2:0}, ${3:0}),
    text: '${4}',
    font: '${5:font}',
    fontSize: ${6:16},
    fontColor: '${7:#ffffff}',
    align: '${8:left}',
    textBaseline: '${9:bottom}',
    ySpacing: ${10:0},
    lineWidth: ${11:0}, // set to add an outline
    strokeStyle: '${12:#000000}',
    innerStroke: ${13:false},
    pixelStroke: ${14:true}, // workaround for Cocoon bug
    antiAlias: ${14:true}, // Cocoon only
    maxWidth: ${15:undefined},
    maxHeight: ${16:undefined},
    linebreaks: ${17:true},
    drawDebug: ${18:false},
    components: [$19]
});
 * @returns Entity
 */
bento.define('bento/gui/text', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/entity',
    'bento/utils',
    'bento/components/sprite',
    'bento/packedimage'
], function (
    Bento,
    Vector2,
    Rectangle,
    Entity,
    Utils,
    Sprite,
    PackedImage
) {
    'use strict';
    var isEmpty = function (obj) {
        var temp;
        if (obj === "" || obj === 0 || obj === "0" || obj === null ||
            obj === false || !Utils.isDefined(obj)) {
            return true;
        }
        //  Check if the array is empty
        if (Utils.isArray(obj) && obj.length === 0) {
            return true;
        }
        //  Check if the object is empty
        if (Utils.isObject(obj)) {
            for (temp in obj) {
                if (Utils.has(obj, temp)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    };

    var Text = function (settings) {
        /*settings = {
            font: string,
            align: string,
            textBaseline: string,
            margin: vector,
            fontColor: string ,
            lineWidth: number or array,
            strokeStyle: string or array,
            innerStroke: boolean or array,
            pixelStroke: boolean, // for the Cocoon strokeText bug
            fontSize: number,
            ySpacing: number,
            position: vector
        }*/
        var text = '';
        var linebreaks = true;
        var maxWidth;
        var maxHeight;
        var fontWeight = 'normal';
        var gradient;
        var gradientColors = ['black', 'white'];
        var align = 'left';
        var font = 'arial';
        var fontSize = 16;
        var originalFontSize = 32;
        var fontColor = 'black';
        var lineWidth = [0];
        var maxLineWidth = 0;
        var strokeStyle = ['black'];
        var innerStroke = [false];
        var textBaseline = 'top';
        var pixelStroke = false;
        var centerByCanvas = false; // quick fix
        var strings = [];
        var spaceWidth = 0;
        var ySpacing = 0;
        var overlaySprite = null;
        var canvas;
        var ctx;
        var packedImage;
        var canvasWidth = 1;
        var canvasHeight = 1;
        var compositeOperation = 'source-over';
        var sharpness = Text.defaultSharpness; // extra scaling to counter blurriness in chrome
        var invSharpness = 1 / sharpness;
        var margin = new Vector2(0, 0);
        var fontSizeCache = {};
        var antiAliasing; // do not set a default value here
        var drawDebug = settings.drawDebug || false;
        var shadow = false;
        var shadowOffset = new Vector2(0, 0);
        var shadowOffsetMax = 0;
        var shadowColor = 'black';
        var didWarn = false;
        var warningCounter = 0;
        /*
         * Prepare font settings, gradients, max width/height etc.
         */
        var applySettings = function (textSettings) {
            var i,
                l,
                maxLength;

            // apply fontSettings
            if (textSettings.fontSettings) {
                Utils.extend(textSettings, textSettings.fontSettings);
            }

            // patch for blurry text in chrome
            if (textSettings.sharpness) {
                sharpness = textSettings.sharpness;
                invSharpness = 1 / sharpness;
                scaler.scale.x = invSharpness;
                scaler.scale.y = invSharpness;
            }
            if (textSettings.fontSize) {
                textSettings.fontSize *= sharpness;
            }

            /*
             * Gradient settings
             * overwrites fontColor behavior
             */
            if (textSettings.gradient) {
                gradient = textSettings.gradient;
            }
            if (textSettings.gradientColors) {
                gradientColors = [];
                for (i = 0, l = textSettings.gradientColors.length; i < l; ++i) {
                    gradientColors[i] = textSettings.gradientColors[i];
                }
            }
            if (textSettings.overlaySprite) {
                overlaySprite = textSettings.overlaySprite;
                if (!overlaySprite.initialized) {
                    overlaySprite.init();
                    overlaySprite.initialized = true;
                }
            }
            /*
             * Alignment settings
             */
            if (textSettings.align) {
                align = textSettings.align;
            }
            if (Utils.isDefined(textSettings.ySpacing)) {
                ySpacing = textSettings.ySpacing * sharpness;
            }
            /*
             * Font settings
             */
            if (textSettings.font) {
                font = textSettings.font;
            }
            if (Utils.isDefined(textSettings.fontSize)) {
                fontSize = textSettings.fontSize;
                originalFontSize = fontSize;
            }
            if (textSettings.fontColor) {
                fontColor = textSettings.fontColor;
            }
            if (textSettings.textBaseline) {
                textBaseline = textSettings.textBaseline;
            }
            if (textSettings.centerByCanvas) {
                centerByCanvas = textSettings.centerByCanvas;
            }
            if (Utils.isDefined(textSettings.fontWeight)) {
                fontWeight = textSettings.fontWeight;
            }
            /*
             * Stroke settings
             * Sets a stroke over the text. You can apply multiple strokes by
             * supplying an array of lineWidths / strokeStyles
             * By default, the strokes are outlines, you can create inner strokes
             * by setting innerStroke to true (for each stroke by supplying an array).
             *
             * lineWidth: {Number / Array of Numbers} width of linestroke(s)
             * strokeStyle: {strokeStyle / Array of strokeStyles} A strokestyle can be a
             *              color string, a gradient object or pattern object
             * innerStroke: {Boolean / Array of booleans} True = stroke becomes an inner stroke, false by default
             */
            if (Utils.isDefined(textSettings.lineWidth)) {
                if (!Utils.isArray(textSettings.lineWidth)) {
                    lineWidth = [textSettings.lineWidth * sharpness];
                } else {
                    lineWidth = textSettings.lineWidth;
                    Utils.forEach(lineWidth, function (item, i, l, breakLoop) {
                        lineWidth[i] *= sharpness;
                    });
                }
            }
            if (textSettings.strokeStyle) {
                if (!Utils.isArray(textSettings.strokeStyle)) {
                    strokeStyle = [textSettings.strokeStyle];
                } else {
                    strokeStyle = textSettings.strokeStyle;
                }
            }
            if (textSettings.innerStroke) {
                if (!Utils.isArray(textSettings.innerStroke)) {
                    innerStroke = [textSettings.innerStroke];
                } else {
                    innerStroke = textSettings.innerStroke;
                }
            }
            pixelStroke = textSettings.pixelStroke || false;
            // align array lengths
            maxLength = Math.max(lineWidth.length, strokeStyle.length, innerStroke.length);
            while (lineWidth.length < maxLength) {
                lineWidth.push(0);
            }
            while (strokeStyle.length < maxLength) {
                strokeStyle.push('black');
            }
            while (innerStroke.length < maxLength) {
                innerStroke.push(false);
            }
            // find max width
            maxLineWidth = 0;
            for (i = 0, l = lineWidth.length; i < l; ++i) {
                // double lineWidth, because we only do outer/inner
                maxLineWidth = Math.max(maxLineWidth, lineWidth[i] * 2);
            }

            // shadow
            if (Utils.isDefined(textSettings.shadow)) {
                shadow = textSettings.shadow;
                if (Utils.isDefined(textSettings.shadowOffset)) {
                    shadowOffset = textSettings.shadowOffset.scalarMultiplyWith(sharpness);
                } else {
                    if (shadow) {
                        // default is 1 pixel down
                        shadowOffset = new Vector2(0, 1 * sharpness);
                    } else {
                        shadowOffset = new Vector2(0, 0);
                    }
                }
                // get largest offset so we can resize the canvas
                shadowOffsetMax = Math.max(Math.abs(shadowOffset.x), Math.abs(shadowOffset.y));
                shadowColor = textSettings.shadowColor || 'black';
            }

            /*
             * entity settings
             */
            if (Utils.isDefined(textSettings.linebreaks)) {
                linebreaks = textSettings.linebreaks;
            }
            if (Utils.isDefined(textSettings.maxWidth)) {
                maxWidth = textSettings.maxWidth * sharpness;
            }
            if (Utils.isDefined(textSettings.maxHeight)) {
                maxHeight = textSettings.maxHeight * sharpness;
            }
            if (Utils.isDefined(textSettings.margin)) {
                margin = textSettings.margin.scalarMultiply(sharpness);
            }

            // set up text
            if (textSettings.text) {
                entity.setText(settings.text);
            } else {
                entity.setText(text);
            }
        };
        var createCanvas = function () {
            if (!canvas) {

                if (settings.fontSettings) {
                    if (Utils.isDefined(settings.fontSettings.antiAlias)) {
                        antiAliasing = settings.fontSettings.antiAlias;
                    }
                } else if (Utils.isDefined(settings.antiAlias)) {
                    antiAliasing = settings.antiAlias;
                }

                // (re-)initialize canvas
                canvas = Bento.createCanvas(antiAliasing);
                ctx = canvas.getContext('2d');
            }
        };
        /*
         * Draw text to canvas
         */
        var updateCanvas = function () {
            var i, ii,
                j, jj,
                l,
                x,
                y,
                scale,
                // extra offset because we may draw a line around the text
                offset = new Vector2(maxLineWidth / 2, maxLineWidth / 2),
                origin = sprite.origin,
                position = entity.position,
                doPixelStroke = function () {
                    var tempCanvas = document.createElement('canvas');
                    var tempCtx = tempCanvas.getContext('2d');
                    var cache = Bento.getAntiAlias();

                    // set anti alias
                    if (Utils.isDefined(antiAliasing)) {
                        Bento.setAntiAlias(antiAliasing);
                    }
                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;

                    // revert anti alias
                    if (Utils.isDefined(antiAliasing)) {
                        Bento.setAntiAlias(cache);
                    }

                    // copy fillText operation with
                    setContext(tempCtx);
                    tempCtx.fillStyle = strokeStyle[j];
                    tempCtx.fillText(strings[i].string, ~~x, ~~y + (navigator.isCocoonJS ? 0 : 0.5));

                    // draw it 8 times on normal canvas
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, -lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, -lineWidth, -lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, -lineWidth, 0, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, -lineWidth, lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, lineWidth, lineWidth, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, lineWidth, 0, tempCanvas.width, tempCanvas.height);
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, lineWidth, -lineWidth, tempCanvas.width, tempCanvas.height);
                },
                doShadow = function () {
                    var tempCanvas = document.createElement('canvas');
                    var tempCtx = tempCanvas.getContext('2d');
                    var cache = Bento.getAntiAlias();

                    // set anti alias
                    if (Utils.isDefined(antiAliasing)) {
                        Bento.setAntiAlias(antiAliasing);
                    }

                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;

                    // revert anti alias
                    if (Utils.isDefined(antiAliasing)) {
                        Bento.setAntiAlias(cache);
                    }

                    // copy fillText operation with
                    setContext(tempCtx);
                    tempCtx.fillStyle = shadowColor;
                    tempCtx.fillText(strings[i].string, ~~x, ~~y + (navigator.isCocoonJS ? 0 : 0.5));

                    // draw it again on normal canvas
                    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, shadowOffset.x, shadowOffset.y, tempCanvas.width, tempCanvas.height);
                };
            createCanvas();

            var cacheAntiAlias = Bento.getAntiAlias();
            // set anti alias (setting width and height will generate a new texture)
            if (Utils.isDefined(antiAliasing)) {
                Bento.setAntiAlias(antiAliasing);
            }

            // resize canvas based on text size
            canvas.width = canvasWidth + maxLineWidth + shadowOffsetMax + margin.x * 2;
            canvas.height = canvasHeight + maxLineWidth + shadowOffsetMax + margin.y * 2;

            // revert anti alias
            if (Utils.isDefined(antiAliasing)) {
                Bento.setAntiAlias(cacheAntiAlias);
            }

            // clear
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // update baseobject
            entity.dimension = new Rectangle(0, 0, canvas.width / sharpness, canvas.height / sharpness);

            // TODO: fix this if needed
            // fit overlay onto canvas
            if (overlaySprite) {
                scale = canvas.width / overlaySprite.getDimension().width;
                if (overlaySprite.scalable) {
                    overlaySprite.scalable.setScale(new Vector2(scale, scale));
                }
            }

            // offset text left or up for shadow if needed
            if (shadow) {
                if (shadowOffset.x < 0) {
                    offset.x -= shadowOffset.x;
                }
                if (shadowOffset.y < 0) {
                    offset.y -= shadowOffset.y;
                }
            }

            // set alignment by setting the origin
            switch (align) {
            case 'left':
                origin.x = 0;
                break;
            case 'center':
                origin.x = margin.x + canvasWidth / 2;
                break;
            case 'right':
                origin.x = margin.x + canvasWidth;
                break;
            default:
                break;
            }
            switch (textBaseline) {
            case 'top':
                origin.y = 0;
                break;
            case 'middle':
                origin.y = margin.y + (centerByCanvas ? canvas.height : canvasHeight) / 2;
                break;
            case 'bottom':
                origin.y = margin.y + (centerByCanvas ? canvas.height : canvasHeight);
                break;
            default:
                break;
            }

            // draw text
            setContext(ctx);
            for (i = 0, ii = strings.length; i < ii; ++i) {
                // gradient or solid color
                if (Utils.isDefined(strings[i].gradient)) {
                    ctx.fillStyle = strings[i].gradient;
                } else {
                    ctx.fillStyle = fontColor;
                }
                // add 1 fontSize because text is aligned to the bottom (most reliable one)
                x = offset.x + origin.x + strings[i].spaceWidth / 2;
                y = offset.y + (i + 1) * fontSize + margin.y + ySpacing * i;

                // outer stroke with pixelStroke
                ctx.globalCompositeOperation = 'source-over';
                if (pixelStroke) {
                    for (j = lineWidth.length - 1; j >= 0; --j) {
                        if (lineWidth[j] && !innerStroke[j]) {
                            doPixelStroke();
                        }
                    }
                }

                // shadow
                if (shadow) {
                    doShadow();
                }

                // fillText
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillText(strings[i].string, ~~x, ~~y + (navigator.isCocoonJS ? 0 : 0.5));


                // pattern
                if (!isEmpty(overlaySprite)) {
                    ctx.globalCompositeOperation = 'source-atop';
                    overlaySprite.setPosition(new Vector2(x, y - fontSize));
                    overlaySprite.draw({
                        canvas: canvas,
                        context: ctx
                    });
                }

                // inner stroke
                ctx.globalCompositeOperation = 'source-atop';
                for (j = 0, jj = lineWidth.length; j < jj; ++j) {
                    if (lineWidth[j] && innerStroke[j]) {
                        ctx.lineWidth = lineWidth[j] * 2;
                        ctx.strokeStyle = strokeStyle[j];
                        ctx.strokeText(strings[i].string, ~~x, ~~y);
                    }
                }

                // outer stroke
                if (!pixelStroke) {
                    ctx.globalCompositeOperation = 'destination-over';
                    for (j = lineWidth.length - 1; j >= 0; --j) {
                        if (lineWidth[j] && !innerStroke[j]) {
                            ctx.lineWidth = lineWidth[j] * 2;
                            ctx.strokeStyle = strokeStyle[j];
                            ctx.strokeText(strings[i].string, ~~x, ~~y);
                        }
                    }
                }
            }
            restoreContext(ctx);

            // delete texture in case of pixi
            if (canvas.texture && canvas.texture.destroy) {
                canvas.texture.destroy();
            }
            canvas.texture = null;
            packedImage = new PackedImage(canvas);
            sprite.setup({
                image: packedImage
            });

            warningCounter += 2;
        };
        /*
         * Restore context and previous font settings
         */
        var restoreContext = function (context) {
            if (!context) {
                return;
            }
            context.textAlign = 'left';
            context.textBaseline = 'bottom';
            context.lineWidth = 0;
            context.strokeStyle = 'black';
            context.fillStyle = 'black';
            context.globalCompositeOperation = compositeOperation;
            context.restore();
        };
        /*
         * Save context and set font settings for drawing
         */
        var setContext = function (context) {
            if (!context) {
                return;
            }
            context.save();
            context.textAlign = align;
            context.textBaseline = 'bottom';
            context.font = fontWeight + ' ' + fontSize.toString() + 'px ' + font;
            compositeOperation = context.globalCompositeOperation;
        };
        /*
         * Splits the string into an array per line (canvas does not support
         * drawing of linebreaks in text)
         */
        var setupStrings = function () {
            var singleStrings = ('' + text).split('\n'),
                stringWidth,
                singleString,
                i, j, l,
                calcGrd,
                subString,
                remainingString,
                spacePos,
                extraSpace = false;

            if (!canvas) {
                if (!didInit && !Text.generateOnConstructor) {
                    // first time initialization with text
                    createCanvas();
                    didInit = true;
                    applySettings(settings);
                }
            }
            
            strings = [];
            canvasWidth = 1;
            canvasHeight = 1;
            setContext(ctx);
            for (i = 0; i < singleStrings.length; ++i) {
                spaceWidth = 0;
                singleString = singleStrings[i];
                l = singleString.length;
                stringWidth = ctx.measureText(singleString).width;
                // do we need to generate extra linebreaks?
                if (linebreaks && !isEmpty(maxWidth) && stringWidth > maxWidth) {
                    // start cutting off letters until width is correct
                    j = 0;
                    while (stringWidth > maxWidth) {
                        ++j;
                        subString = singleString.slice(0, singleString.length - j);
                        stringWidth = ctx.measureText(subString).width;
                        // no more letters left: assume 1 letter
                        if (j === l) {
                            j = l - 1;
                            break;
                        }
                    }
                    // find first space to split (if there are no spaces, we just split at our current position)
                    spacePos = subString.lastIndexOf(' ');
                    if (spacePos > 0 && spacePos != subString.length) {
                        // set splitting position
                        j += subString.length - spacePos;
                    }
                    // split the string into 2
                    remainingString = singleString.slice(l - j, l);
                    singleString = singleString.slice(0, l - j);

                    // remove first space in remainingString
                    if (remainingString.charAt(0) === ' ') {
                        remainingString = remainingString.slice(1);
                    }

                    // the remaining string will be pushed into the array right after this one
                    if (remainingString.length !== 0) {
                        singleStrings.splice(i + 1, 0, remainingString);
                    }

                    // set width correctly and proceed
                    stringWidth = ctx.measureText(singleString).width;
                }

                if (stringWidth > canvasWidth) {
                    canvasWidth = stringWidth;
                }

                calcGrd = calculateGradient(stringWidth, i);
                strings.push({
                    string: singleString,
                    width: stringWidth,
                    gradient: calcGrd,
                    spaceWidth: spaceWidth
                });
                canvasHeight += fontSize + ySpacing;
            }
        };
        /*
         * Prepares the gradient object for every string line
         * @param {Number} width - Gradient width
         * @param {index} index - String index of strings array
         */
        var calculateGradient = function (width, index) {
            var grd,
                startGrd = {
                    x: 0,
                    y: 0
                },
                endGrd = {
                    x: 0,
                    y: 0
                },
                gradientValue,
                i,
                l,
                top,
                bottom;

            if (!gradient) {
                return;
            }

            top = (fontSize + ySpacing) * index;
            bottom = (fontSize + ySpacing) * (index + 1);

            switch (gradient) {
            case 'top-down':
                startGrd.x = 0;
                startGrd.y = top;
                endGrd.x = 0;
                endGrd.y = bottom;
                break;
            case 'down-top':
                startGrd.x = 0;
                startGrd.y = bottom;
                endGrd.x = 0;
                endGrd.y = top;
                break;
            case 'left-right':
                startGrd.x = 0;
                startGrd.y = 0;
                endGrd.x = width;
                endGrd.y = 0;
                break;
            case 'right-left':
                startGrd.x = width;
                startGrd.y = 0;
                endGrd.x = 0;
                endGrd.y = 0;
                break;
            case 'topleft-downright':
                startGrd.x = 0;
                startGrd.y = top;
                endGrd.x = width;
                endGrd.y = bottom;
                break;
            case 'topright-downleft':
                startGrd.x = width;
                startGrd.y = top;
                endGrd.x = 0;
                endGrd.y = bottom;
                break;
            case 'downleft-topright':
                startGrd.x = 0;
                startGrd.y = bottom;
                endGrd.x = width;
                endGrd.y = top;
                break;
            case 'downright-topleft':
                startGrd.x = width;
                startGrd.y = bottom;
                endGrd.x = 0;
                endGrd.y = top;
                break;
            default:
                break;
            }
            // offset with the linewidth
            startGrd.x += maxLineWidth / 2;
            startGrd.y += maxLineWidth / 2;
            endGrd.x += maxLineWidth / 2;
            endGrd.y += maxLineWidth / 2;

            grd = ctx.createLinearGradient(
                startGrd.x,
                startGrd.y,
                endGrd.x,
                endGrd.y
            );
            for (i = 0.0, l = gradientColors.length; i < l; ++i) {
                gradientValue = i * (1 / (l - 1));
                grd.addColorStop(gradientValue, gradientColors[i]);
            }

            return grd;
        };
        var didInit = false;
        var debugDrawComponent = {
            name: 'debugDrawComponent',
            draw: function (data) {
                // draw the debug box while we're at it
                var entity;
                var box;
                var relativeOrigin = new Vector2(0, 0);
                var absoluteOrigin = new Vector2(0, 0);
                if (
                    (Text.drawDebug || drawDebug) &&
                    (maxWidth !== null || maxHeight !== null)
                ) {
                    entity = data.entity;

                    // predict where the origin will be if max is not reached
                    relativeOrigin.x = sprite.origin.x / entity.dimension.width;
                    relativeOrigin.y = sprite.origin.y / entity.dimension.height;
                    absoluteOrigin = sprite.origin.clone();
                    if (maxWidth !== null) {
                        absoluteOrigin.x = relativeOrigin.x * maxWidth;
                    }
                    if (maxHeight !== null) {
                        absoluteOrigin.y = relativeOrigin.y * maxHeight;
                    }

                    box = new Rectangle(
                        absoluteOrigin.x * -1 || 0,
                        absoluteOrigin.y * -1 || 0,
                        maxWidth || entity.dimension.width,
                        maxHeight || entity.dimension.height
                    );
                    data.renderer.fillRect([0, 0, 1, 0.25], box.x, box.y, box.width, box.height);
                    // draw edges
                    if (maxWidth !== null) {
                        data.renderer.drawLine([0, 0, 1, 0.5], box.x, box.y, box.x, box.y + box.height, 1);
                        data.renderer.drawLine([0, 0, 1, 0.5], box.x + box.width, box.y, box.x + box.width, box.y + box.height, 1);
                    }
                    if (maxHeight !== null) {
                        data.renderer.drawLine([0, 0, 1, 0.5], box.x, box.y, box.x + box.width, box.y, 1);
                        data.renderer.drawLine([0, 0, 1, 0.5], box.x, box.y + box.height, box.x + box.width, box.y + box.height, 1);
                    }
                }
            },
            start: function () {
                // re-init canvas
                if (!canvas) {
                    if (!didInit && !Text.generateOnConstructor) {
                        // first time initialization with text
                        createCanvas();
                        didInit = true;
                        applySettings(settings);
                    } else {
                        // just reinit the canvas
                        updateCanvas();
                    }
                }
            },
            destroy: function () {
                if (Text.disposeCanvas && canvas) {
                    if (canvas.dispose) {
                        // destroy Cocoon texture
                        canvas.dispose();
                    }
                    if (canvas.texture && canvas.texture.destroy) {
                        // destroy PixiJS texture
                        canvas.texture.destroy();
                    }
                    canvas = null;
                    packedImage = null;
                }
            },
            update: function () {
                if (warningCounter) {
                    warningCounter -= 1;
                }
                if (!didWarn && warningCounter > 600 && !Text.suppressWarnings) {
                    didWarn = true;
                    console.warn('PERFORMANCE WARNING: for the past 600 frames this Text module has been updating all the time.', entity);
                }
            }
        };
        var sprite = new Sprite({
            image: packedImage
        });
        var scaler = new Entity({
            name: 'sharpnessScaler',
            scale: new Vector2(invSharpness, invSharpness),
            components: [
                debugDrawComponent,
                sprite
            ]
        });
        var entitySettings = Utils.extend({
            z: 0,
            name: 'text',
            position: new Vector2(0, 0)
        }, settings, true);

        // merge components array
        entitySettings.components = settings.components || [];

        var entity;

        // add the scaler (debugDrawComponent and sprite) as top component
        entitySettings.components = [scaler].concat(entitySettings.components || []);

        entity = new Entity(entitySettings).extend({
            /**
             * Get a reference to the internal canvas
             * @function
             * @instance
             * @name getCanvas
             * @returns HTMLCanvasElement
             */
            getCanvas: function () {
                return canvas;
            },
            /**
             * Retrieve current text
             * @function
             * @instance
             * @name getText
             * @returns String
             * @snippet #Text.getText|String
                getText();
             */
            getText: function () {
                return text;
            },
            /**
             * Get array of the string setup settings
             * @function
             * @instance
             * @name getStrings
             * @snippet #Text.getStrings|Array
                getStrings();
             * @returns Array
             */
            getStrings: function () {
                return strings;
            },
            /**
             * Sets and displays current text
             * @param {String} text - The string you want to set
             * @param {Object} settings (optional) - Apply new settings for text visuals
             * @function
             * @instance
             * @name setText
             * @snippet #Text.setText|snippet
                setText('$1');
             * @snippet #Text.setText|settings
                setText('$1', ${2:{}});
             */
            setText: function (str, settings) {
                var cachedFontSize = 0,
                    hash;
                //reset fontSize
                fontSize = originalFontSize;

                if (settings) {
                    applySettings(settings);
                }
                text = str;
                setupStrings();

                // check maxWidth and maxHeight
                if (!isEmpty(maxWidth) || !isEmpty(maxHeight)) {
                    hash = Utils.checksum(str + '_' + maxWidth + '_' + maxHeight);
                    if (Utils.isDefined(fontSizeCache[hash])) {
                        fontSize = fontSizeCache[hash];
                        setupStrings();
                    } else {
                        while (fontSize > 0 && ((!isEmpty(maxWidth) && canvasWidth > maxWidth) || (!isEmpty(maxHeight) && canvasHeight > maxHeight))) {
                            // try again by reducing fontsize
                            fontSize -= 1;
                            setupStrings();
                        }
                        fontSizeCache[hash] = fontSize;
                    }
                }
                updateCanvas();

                return fontSize / sharpness;
            },
            /**
             * Retrieve the font size that was used to render the text
             * @function
             * @instance
             * @name getEffectiveFontSize
             * @returns Number
             * @snippet #Text.getEffectiveFontSize|Number
                getEffectiveFontSize();
             */
            getEffectiveFontSize: function () {
                return fontSize / sharpness;
            }

        });

        if (Text.generateOnConstructor) {
            createCanvas();
            applySettings(settings);
        }

        return entity;
    };

    // static value drawDebug
    Text.drawDebug = false;

    // clean up internal canvas immediately on destroy
    Text.disposeCanvas = true;

    // legacy setting
    Text.generateOnConstructor = false;

    Text.suppressWarnings = false;

    // static value for default sharpness so it can be applied to all text beforehand
    Text.defaultSharpness = 4;

    return Text;
});
/**
 * An entity that behaves like a toggle button.
 * <br>Exports: Constructor
 * @param {Object} settings - Required, can include Entity settings
 * @param {Sprite} settings.sprite - Same as clickbutton! See @link module:bento/gui/clickbutton}
 * @param {Bool} settings.active - Whether the button starts in the active state (default: true)
 * @param {Bool} settings.toggled - Initial toggle state (default: false)
 * @param {String} settings.onToggle - Callback when user clicks on the toggle ("this" refers to the clickbutton entity).
 * @param {String} [settings.sfx] - Plays sound when pressed
 * @module bento/gui/togglebutton
 * @moduleName ToggleButton
 * @returns Entity
 * @snippet ToggleButton|constructor
ToggleButton({
    z: ${1:0},
    name: '$2',
    sfx: '$3',
    imageName: '$4',
    frameCountX: ${5:1},
    frameCountY: ${6:3},
    position: new Vector2(${7:0}, ${8:0}),
    updateWhenPaused: ${9:0},
    float: ${10:false},
    onToggle: function () {
        ${11}
    }
});
 */
bento.define('bento/gui/togglebutton', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/utils',
    'bento/tween',
    'bento/eventsystem'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    Utils,
    Tween,
    EventSystem
) {
    'use strict';
    return function (settings) {
        var viewport = Bento.getViewport();
        var active = true;
        var toggled = false;
        var animations = settings.animations || {
            'up': {
                speed: 0,
                frames: [0]
            },
            'down': {
                speed: 0,
                frames: [1]
            }
        };
        var sprite = settings.sprite || new Sprite({
            image: settings.image,
            imageName: settings.imageName,
            originRelative: settings.originRelative || new Vector2(0.5, 0.5),
            padding: settings.padding,
            frameWidth: settings.frameWidth,
            frameHeight: settings.frameHeight,
            frameCountX: settings.frameCountX,
            frameCountY: settings.frameCountY,
            animations: animations
        });
        var clickable = new Clickable({
            sort: settings.sort,
            ignorePauseDuringPointerUpEvent: settings.ignorePauseDuringPointerUpEvent,
            onClick: function () {
                if (!active) {
                    return;
                }
                sprite.setAnimation('down');
                EventSystem.fire('toggleButton-toggle-down', {
                    entity: entity,
                    event: 'onClick'
                });
            },
            onHoldEnter: function () {
                if (!active) {
                    return;
                }
                sprite.setAnimation('down');
                EventSystem.fire('toggleButton-toggle-down', {
                    entity: entity,
                    event: 'onHoldEnter'
                });
            },
            onHoldLeave: function () {
                if (!active) {
                    return;
                }
                sprite.setAnimation(toggled ? 'down' : 'up');
                EventSystem.fire('toggleButton-toggle-' + (toggled ? 'down' : 'up'), {
                    entity: entity,
                    event: 'onHoldLeave'
                });
            },
            pointerUp: function () {
                if (!active) {
                    return;
                }
                sprite.setAnimation(toggled ? 'down' : 'up');
                EventSystem.fire('toggleButton-toggle-' + (toggled ? 'down' : 'up'), {
                    entity: entity,
                    event: 'pointerUp'
                });
            },
            onHoldEnd: function () {
                if (!active) {
                    return;
                }
                if (toggled) {
                    toggled = false;
                } else {
                    toggled = true;
                }
                if (settings.onToggle) {
                    settings.onToggle.apply(entity);
                    if (settings.sfx) {
                        Bento.audio.stopSound(settings.sfx);
                        Bento.audio.playSound(settings.sfx);
                    }
                }
                sprite.setAnimation(toggled ? 'down' : 'up');
                EventSystem.fire('toggleButton-onToggle', {
                    entity: entity,
                    event: 'onHoldEnd'
                });
            }
        });
        var entitySettings = Utils.extend({
            z: 0,
            name: 'toggleButton',
            position: new Vector2(0, 0),
            family: ['buttons']
        }, settings);

        // merge components array
        entitySettings.components = [
            sprite,
            clickable
        ].concat(settings.components || []);

        var entity = new Entity(entitySettings).extend({
            /**
             * Check if the button is toggled
             * @function
             * @instance
             * @name isToggled
             * @snippet #ToggleButton.isToggled|Boolean
                isToggled();
             * @returns {Bool} Whether the button is toggled
             */
            isToggled: function () {
                return toggled;
            },
            /**
             * Toggles the button programatically
             * @function
             * @param {Bool} state - Toggled or not
             * @param {Bool} doCallback - Perform the onToggle callback or not
             * @instance
             * @name toggle
             * @snippet #ToggleButton.toggle|snippet
                toggle(${1:true});
             * @snippet #ToggleButton.toggle|do callback
                toggle(${1:true}, true);
             */
            toggle: function (state, doCallback) {
                if (Utils.isDefined(state)) {
                    toggled = state;
                } else {
                    toggled = !toggled;
                }
                if (doCallback) {
                    if (settings.onToggle) {
                        settings.onToggle.apply(entity);
                        if (settings.sfx) {
                            Bento.audio.stopSound(settings.sfx);
                            Bento.audio.playSound(settings.sfx);
                        }
                    }
                }
                sprite.setAnimation(toggled ? 'down' : 'up');
            },
            /**
             * Activates or deactives the button. Deactivated buttons cannot be pressed.
             * @function
             * @param {Bool} active - Should be active or not
             * @instance
             * @name setActive
             * @snippet #ToggleButton.setActive|snippet
                setActive(${1:true});
             */
            setActive: function (bool) {
                active = bool;
                if (!active && animations.inactive) {
                    sprite.setAnimation('inactive');
                } else {
                    sprite.setAnimation(toggled ? 'down' : 'up');
                }
            },
            /**
             * Performs the onClick callback, ignores active state
             * @function
             * @instance
             * @name doCallback
             * @snippet #ToggleButton.doCallback|snippet
                doCallback();
             */
            doCallback: function () {
                settings.onToggle.apply(entity);
            },
            /**
             * Performs the callback as if the button was clicked, 
             * takes active state into account 
             * @function
             * @instance
             * @name mimicClick
             * @snippet #ToggleButton.mimicClick|snippet
                mimicClick();
             */
            mimicClick: function () {
                if (active) {
                    entity.toggle(!toggled, true);
                }
            },

            /**
             * Check if the button is active
             * @function
             * @instance
             * @name isActive
             * @returns {Bool} Whether the button is active
             * @snippet #ToggleButton.isActive|Boolean
                isActive();
             */
            isActive: function () {
                return active;
            }
        });

        if (Utils.isDefined(settings.active)) {
            active = settings.active;
        }
        // set intial state
        if (settings.toggled) {
            toggled = true;
        }

        animations = sprite.animations || animations;
        if (!active && animations.inactive) {
            sprite.setAnimation('inactive');
        } else {
            sprite.setAnimation(toggled ? 'down' : 'up');
        }

        // events for the button becoming active
        entity.attach({
            name: 'attachComponent',
            start: function () {
                EventSystem.fire('toggleButton-start', {
                    entity: entity
                });
            },
            destroy: function () {
                EventSystem.fire('toggleButton-destroy', {
                    entity: entity
                });
            }
        });

        // active property
        Object.defineProperty(entity, 'active', {
            get: function () {
                return active;
            },
            set: entity.setActive
        });

        return entity;
    };
});
/*
 * DEPRECATED
 * Simple container that masks the children's sprites in a rectangle. Does not work with rotated children.
 * The container's boundingbox is used as mask.
 * @moduleName MaskedContainer
 */
bento.define('bento/maskedcontainer', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/eventsystem',
    'bento/gui/clickbutton',
    'bento/gui/counter',
    'bento/gui/text',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    EventSystem,
    ClickButton,
    Counter,
    Text,
    Utils,
    Tween
) {
    'use strict';
    return function (settings) {
        var viewport = Bento.getViewport();
        var components = settings.components || [];
        var container;
        var maskedDraw = function (data) {
            // target rectangle to draw, determine x and y below
            var target;
            // mask is local to the container
            var mask = container.getBoundingBox();
            if (!this.currentAnimation || !this.visible) {
                return;
            }

            // do the sprite update
            var entity = data.entity;
            this.updateFrame();

            // determine target
            // target is local to the sprite
            target = new Rectangle(
                (-this.origin.x) | 0,
                (-this.origin.y) | 0,
                this.frameWidth,
                this.frameHeight
            );

            // we have to transform the mask to the sprite's local space
            // first to world
            var maskTopLeftWorld = container.toWorldPosition(mask.getCorner(Rectangle.TOPLEFT));
            var maskBottomRightWorld = container.toWorldPosition(mask.getCorner(Rectangle.BOTTOMRIGHT));
            // world to sprite's local
            var maskTopLeft = entity.toLocalPosition(maskTopLeftWorld);
            var maskBottomRight = entity.toLocalPosition(maskBottomRightWorld);
            // construct a rectangle using the topleft and bottomright positions
            var localMask = new Rectangle(maskTopLeft.x, maskTopLeft.y, maskBottomRight.x - maskTopLeft.x, maskBottomRight.y - maskTopLeft.y);
            // get the intersection between mask and target
            var intersection = localMask.intersection(target);

            if (!intersection.width && !intersection.height) {
                // there is nothing to draw
                return;
            }
            // console.log(intersection)

            data.renderer.drawImage(
                this.spriteImage,
                this.sourceX + (intersection.x - target.x),
                this.sourceY + (intersection.y - target.y),
                intersection.width,
                intersection.height,
                intersection.x,
                intersection.y,
                intersection.width,
                intersection.height
            );
        };
        // traverse through children, find sprites
        var traverse = function (children) {
            Utils.forEach(children, function (child, i, l, breakLoop) {
                // check if this is an entity
                if (child.components) {
                    traverse(child.components);
                }
                // overwrite the sprite's draw function
                if (child.name === 'sprite' && child.draw !== maskedDraw) {
                    child.draw = maskedDraw;
                }
            });
        };
        // this component traverses through all child components and updates the sprites
        var watcher = {
            name: 'componentWatcher',
            start: function () {
                traverse(components);
            },
            update: function () {
                // would be better to only traverse when a new entity/component is attached, this requires some new event
                // for now, it's a setting
                if (settings.watchComponents) {
                    traverse(components);
                }
            }
        };

        components.push(watcher);

        container = new Entity(settings);
        return container;
    };
});
/**
 * General object pool
 * <br>Exports: Constructor
 * @param {Object} settings - Settings object is required
 * @param {Function} settings.constructor - function that returns the object for pooling
 * @param {Function} settings.destructor - function that resets object for reuse
 * @param {Number} settings.poolSize - amount to pre-initialize
 * @module bento/objectpool
 * @moduleName ObjectPool
 * @returns ObjectPool
 */
bento.define('bento/objectpool', [
    'bento',
    'bento/utils'
], function (
    Bento,
    Utils
) {
    'use strict';
    return function (specs) {
        var pool = [],
            isInitialized = false,
            constructor = specs.constructor,
            destructor = specs.destructor,
            pushObject = function () {
                pool.push(constructor());
            };

        if (!constructor) {
            throw 'Error: Must pass a settings.constructor function that returns an object';
        }
        if (!destructor) {
            throw 'Error: Must pass a settings.destructor function that cleans the object';
        }

        // return interface
        return {
            /**
             * Returns a new object from the pool, the pool is populated automatically if empty
             */
            get: function () {
                // pool is empty!
                if (pool.length === 0) {
                    pushObject();
                }
                // get the last in the pool
                return pool.pop();
            },
            /**
             * Puts object back in the pool
             */
            discard: function (obj) {
                // reset the object
                destructor(obj);
                // put it back
                pool.push(obj);
            },
            init: function () {
                if (isInitialized) {
                    return;
                }
                isInitialized = true;
                Utils.repeat(specs.poolSize || 0, pushObject);

            }
        };
    };
});
/**
 * Screen object. Screens are convenience modules that are similar to levels/rooms/scenes in games.
 * Tiled Map Editor can be used to design the levels {@link http://www.mapeditor.org/}.
 * Note: in Tiled, you must export as json file and leave uncompressed as CSV (for now)
 * <br>Exports: Constructor
 * @module bento/screen
 * @moduleName Screen
 * @param {Object} settings - Settings object
 * @param {String} settings.tiled - Asset name of the json file
 * @param {String} settings.onShow - Callback when screen starts
 * @param {String} settings.onHide - Callback when screen is removed
 * @param {Rectangle} [settings.dimension] - Set dimension of the screen (overwritten by tmx size)
 * @returns Screen
 */
bento.define('bento/screen', [
    'bento/utils',
    'bento',
    'bento/math/rectangle',
    'bento/math/vector2',
    'bento/tiled'
], function (Utils, Bento, Rectangle, Vector2, Tiled) {
    'use strict';
    var Screen = function (settings) {
        /*settings = {
            dimension: Rectangle, [optional / overwritten by tmx size]
            tiled: String
        }*/
        var viewport = Bento.getViewport(),
            module = {
                /**
                 * Name of the screen
                 * @instance
                 * @name name
                 */
                name: null,
                /**
                 * Reference to Tiled object (if tiled was used)
                 * @instance
                 * @see module:bento/tiled
                 * @name tiled
                 */
                tiled: null,
                /**
                 * Dimension of the screen
                 * @instance
                 * @name dimension
                 */
                dimension: (settings && settings.dimension) ? settings.dimension : viewport.clone(),
                extend: function (object) {
                    return Utils.extend(this, object);
                },
                /**
                 * Loads a tiled map
                 * @function
                 * @instance
                 * @returns {String} name - Name of the JSON asset
                 * @name loadTiled
                 */
                loadTiled: function (name) {
                    this.tiled = new Tiled({
                        assetName: name,
                        spawnBackground: true,
                        spawnEntities: true
                    });
                    this.dimension = this.tiled.dimension;
                },
                /**
                 * Callback when the screen is shown (called by screen manager)
                 * @function
                 * @instance
                 * @returns {Object} data - Extra data to be passed
                 * @name onShow
                 */
                onShow: function (data) {
                    if (settings) {
                        // load tiled map if present
                        if (settings.tiled) {
                            this.loadTiled(settings.tiled);
                        }
                        // callback
                        if (settings.onShow) {
                            settings.onShow.call(module, data);
                        }
                    }
                },
                /**
                 * Removes all objects and restores viewport position
                 * @function
                 * @instance
                 * @returns {Object} data - Extra data to be passed
                 * @name onHide
                 */
                onHide: function (data) {
                    var viewport = Bento.getViewport();
                    // 1st callback
                    if (settings.onHide) {
                        settings.onHide.call(module, data);
                    }
                    // reset viewport scroll when hiding screen
                    viewport.x = 0;
                    viewport.y = 0;
                    // remove all objects
                    Bento.removeAll();

                    // 2nd callback
                    if (settings.onHidden) {
                        settings.onHidden.call(module, data);
                    }
                    // reset pause level
                    Bento.objects.resume();
                }
            };

        return module;
    };
    return Screen;
});
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

    var isLoopingEvents = false;
    var objects = null;
    var events = {};
    /*events = {
        [String eventName]: [Array listeners = {callback: Function, context: this}]
    }*/
    var removedEvents = [];
    var cleanEventListeners = function () {
        var i, j, l, listeners, eventName, callback, context;

        if (isLoopingEvents) {
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

        if (!isLoopingEvents) {
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

        if (!isLoopingEvents) {
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

            for (i = 0, l = listeners.length; i < l; ++i) {
                isLoopingEvents = true;
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
            isLoopingEvents = false;
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
/**
 * Reads Tiled JSON file and draws layers.
 * Tile layers are drawn onto canvas images. If the map is larger than maxCanvasSize (default 1024 * 1024),
 * the layer is split into multiple canvases. Easiest way to get started is to pass the asset name of the Tiled
 * JSON and set spawnBackground and spawnEntities to true.
 * <br>Exports: Constructor
 * @module bento/tiled
 * @moduleName Tiled
 * @param {Object} settings - Settings object
 * @param {String} settings.assetName - Name of the Tiled JSON asset to load
 * @param {Boolean} [settings.merge] - Merge tile layers into a single canvas layer, default: false
 * @param {Vector2} [settings.maxCanvasSize] - Max canvasSize for the canvas objects, default: Vector2(1024, 1024)
 * @param {Vector2} [settings.offset] - Offsets all entities/backgrounds spawned
 * @param {Function} [settings.onInit] - Callback on initial parsing, parameters: (tiledJson, externalTilesets)
 * @param {Function} [settings.onLayer] - Callback when the reader passes a layer object, parameters: (layer)
 * @param {Function} [settings.onTile] - Callback after tile is drawn, parameters: (tileX, tileY, tilesetJSON, tileIndex)
 * @param {Function} [settings.onObject] - Callback when the reader passes a Tiled object, parameters: (objectJSON, tilesetJSON, tileIndex) <br>Latter two if a gid is present. If no gid is present in the object JSON, it's most likely a shape! Check for object.rectangle, object.polygon etc.
 * @param {Function} [settings.onComplete] - Called when the reader passed all layers
 * @param {Boolean} [settings.drawTiles] - Draw tiles (default: true)
 * @param {Boolean} [settings.spawnBackground] - Spawns background entities (drawn tile layers)
 * @param {Boolean} [settings.spawnEntities] - Spawns objects (in Tiled: assign a tile property called "module" and enter the module name, placing an object with that tile will spawn the corresponding entity), shapes are not spawned! You are expected to handle this yourself with the onObject callback.
 * @param {Boolean} [settings.onSpawn] - Callback when entity is spawned, parameters: (entity)
 * @param {Boolean} [settings.onSpawnComplete] - Callback when all entities were spawned, may be called later than onComplete due to its asynchronous nature
 * @param {Boolean} [settings.cacheModules] - Cache spawned modules. Modules are retrieved with bento.require, caching them can speed up loading. Note that it also can clash with quick reloading unless the cache is cleared on reload. default: false
 * @returns Object
 * @snippet Tiled|constructor
Tiled({
    assetName: '$1',
    drawTiles: ${2:true},
    merge: ${3:false},
    spawnEntities: ${4:true}, // require the module (asynchronously)
    spawnBackground: ${5:true}, // spawn background entities (drawn tile layers)
    attachEntities: ${6:true}, // attach after spawning
    onInit: function (tiledJson, externalTilesets) {
        // Callback after initial parsing
        $7
    },
    onLayer: function (layer) {
        // Callback when the reader passes a layer
        $8
    },
    onTile: function (tileX, tileY, tilesetJSON, tileIndex) {
        // Callback after tile is drawn
        $9
    },
    onObject: function (objectJSON, tilesetJSON, tileIndex) {
        // Callback when the reader passes a Tiled object
        ${10}
    },
    onComplete: function () {
        // Synchronous callback when the reader passed all layers
        // `this` references the tiled object (to get width and height)
        ${11}
    },
    onLayerMergeCheck: function (layer) {
        // called for each layer when merge: true
        // return false if layer should not merge
        return ${12:true};
    },
    onSpawn: function (entity) {
        // called after all a module is spawned (asynchronous)
        ${13}
    },
    onSpawnComplete: function () {
        // called after all modules are spawned (asynchronous)
        ${14}
    }
});
 */
bento.define('bento/tiled', [
    'bento',
    'bento/entity',
    'bento/components/sprite',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/math/polygon',
    'bento/packedimage',
    'bento/utils',
    'bento/tiledreader'
], function (
    Bento,
    Entity,
    Sprite,
    Vector2,
    Rectangle,
    Polygon,
    PackedImage,
    Utils,
    TiledReader
) {
    'use strict';
    // cached modules by require
    var cachedModules = {
        // name: argumentsArray
    };
    var cachedLayerSprites = {
        // name: LayerSprites
    };
    // a collection of sprites/canvases that represent the drawn tiled layers
    var LayerSprites = function (canvasSize, mapSize) {
        // number of sprites horizontally
        var spritesCountX = Math.ceil(mapSize.x / canvasSize.x);
        var spritesCountY = Math.ceil(mapSize.y / canvasSize.y);
        // combined width of canvases
        var width = spritesCountX * canvasSize.x;
        var height = spritesCountY * canvasSize.y;
        // collection of canvases
        var layers = {
            // "0": [canvas, canvas, ...]
            length: 0
        };
        var initLayer = function (layerId) {
            var i;
            var layer = [];
            var canvas;
            var context;

            for (i = 0; i < spritesCountX * spritesCountY; ++i) {
                canvas = Bento.createCanvas();
                canvas.width = canvasSize.x;
                canvas.height = canvasSize.y;
                context = canvas.getContext('2d');
                canvas.context = context;
                layer.push(canvas);
            }
            layers[layerId] = layer;
            layers.length = Math.max(layers.length, layerId + 1);
        };
        var getCanvas = function (layerId, destination) {
            // convert destination position to array index
            var x = Math.floor(destination.x / canvasSize.x) % spritesCountX;
            var y = Math.floor(destination.y / canvasSize.y) % spritesCountY;
            var index = x + y * spritesCountX;

            // init collection if needed
            if (!layers[layerId]) {
                initLayer(layerId);
            }

            return {
                index: index,
                canvas: layers[layerId][index]
            };
        };

        return {
            spritesCountX: spritesCountX,
            spritesCountY: spritesCountY,
            canvasSize: canvasSize,
            layers: layers,
            drawn: false, // used to check if cached
            getSpritesFromLayer: function (layerId) {
                return layers[layerId];
            },
            drawTile: function (layerId, destination, source, packedImage, flipX, flipY, flipD, opacity) {
                // get the corresponding canvas
                var canvasData = getCanvas(layerId, destination);
                var canvas = canvasData.canvas;
                var index = canvasData.index;
                var context = canvas.context;
                var doFlipX = false;
                var doFlipY = false;
                var rotation = 0;
                var tx = 0, ty = 0, sx = 0, sy = 0;
                // canvas offset
                var offset = new Vector2(
                    canvasSize.x * (index % spritesCountX),
                    canvasSize.y * Math.floor(index / spritesCountX)
                );

                // convert to rotation and flipping
                if (!flipD) {
                    if (flipX && flipY) {
                        rotation = Math.PI;
                    } else {
                        doFlipX = flipX;
                        doFlipY = flipY;
                    }
                } else {
                    if (!flipX && !flipY) {
                        rotation = Math.PI / 2;
                        doFlipY = true;
                    } else if (flipX && !flipY) {
                        rotation = Math.PI / 2;
                    } else if (!flipX && flipY) {
                        rotation = Math.PI * 3 / 2;
                    } else if (flipX && flipY) {
                        rotation = Math.PI / 2;
                        doFlipX = true;
                    }
                }

                // context.save();
                // move to destination
                tx += destination.x - offset.x;
                ty += destination.y - offset.y;
                // offset origin for rotation
                tx += source.width / 2;
                ty += source.height / 2;
                // scale
                sx = doFlipX ? -1 : 1;
                sy = doFlipY ? -1 : 1;
                // apply transforms
                context.translate(tx, ty);
                context.rotate(rotation);
                context.scale(sx, sy);
                // offset origin
                context.translate(-source.width / 2, -source.height / 2);
                // opacity
                if (opacity !== undefined) {
                    context.globalAlpha = opacity;
                }

                // draw the tile!
                context.drawImage(
                    packedImage.image,
                    packedImage.x + source.x,
                    packedImage.y + source.y,
                    source.width,
                    source.height,
                    0,
                    0,
                    destination.width,
                    destination.height
                );
                // restore transforms
                context.globalAlpha = 1;
                context.translate(source.width / 2, source.height / 2);
                context.scale(1 / sx, 1 / sy);
                context.rotate(-rotation);
                context.translate(-tx, -ty);
                
                // context.restore();
            },
            dispose: function () {
                // Cocoon: dispose canvasses
                Utils.forEach(layers, function (layer) {
                    if (layer.length) {
                        Utils.forEach(layer, function (canvas) {
                            if (canvas) {
                                if (canvas.dispose) {
                                    // destroy Cocoon texture
                                    canvas.dispose();
                                }
                                if (canvas.texture && canvas.texture.destroy) {
                                    // destroy PixiJS texture
                                    canvas.texture.destroy();
                                }
                            }
                        });
                    }
                });
            }
        };
    };
    var getCachedLayerSprites = function (name, maxCanvasSize, mapSize) {
        var cache = cachedLayerSprites[name];
        if (cache) {
            return cache;
        } else {
            return new LayerSprites(maxCanvasSize, mapSize);
        }
    };

    var Tiled = function (settings) {
        var assetName = settings.assetName;
        var drawTiles = Utils.isDefined(settings.drawTiles) ? settings.drawTiles : true;
        var json = settings.tiled || Bento.assets.getJson(assetName);
        var width = json.width || 0;
        var height = json.height || 0;
        var tileWidth = json.tilewidth || 0;
        var tileHeight = json.tileheight || 0;
        var mapProperties = json.properties || {};
        var mergeLayers = settings.merge || false;
        var onInit = settings.onInit;
        var onLayer = settings.onLayer;
        var onTile = settings.onTile;
        var onObject = settings.onObject;
        var onComplete = settings.onComplete;
        var onSpawn = settings.onSpawn;
        var onSpawnComplete = settings.onSpawnComplete;
        var onLayerMergeCheck = settings.onLayerMergeCheck;
        var cacheModules = settings.cacheModules || false;
        var cacheCanvas = settings.cacheCanvas || false;
        var attachEntities = Utils.getDefault(settings.attachEntities, true);
        var offset = settings.offset || new Vector2(0, 0);
        var maxCanvasSize = settings.maxCanvasSize || new Vector2(1024, 1024);
        var mapSize = new Vector2(width * tileWidth, height * tileHeight);
        var currentSpriteLayer = -1;
        var layerSprites = getCachedLayerSprites(assetName, maxCanvasSize, mapSize);
        var entities = [];
        var backgrounds = [];
        var entitiesSpawned = 0;
        var entitiesToSpawn = 0;
        var opacity = 1;
        var currentLayer = 0;
        var tiledReader = new TiledReader({
            tiled: json,
            onInit: onInit,
            onExternalTileset: function (source) {
                // unfortunately, external tileset paths are relative to the tile json path
                // making it difficult to load (would need to do path parsing etc...)
                // instead we try to make an educated guess what the asset name is
                var json;
                var jsonPath = source.indexOf('json/');
                var relativePath = source.indexOf('../');
                var path = source;
                var split;
                if (jsonPath >= 0) {
                    // if the name "json/" is there, we can guess the path is after the json/ part
                    path = source.substring(jsonPath + ('json/').length);
                } else if (relativePath >= 0) {
                    // no json/ is there and the path has relative indicators
                    path = source;

                    if (assetName) {
                        // path parsing, urgh
                        split = assetName.split('/');
                        split.pop(); // remove filename
                        while (path.indexOf('../') >= 0) {
                            if (split.length === 0) {
                                throw "ERROR: Impossible path to external tileset";
                            }
                            // move up one folder
                            split.pop();
                            path = path.replace('../', '');
                        }
                        // final path, may need an extra slash
                        path = split.join('/') + (split.length ? '/' : '') + path;
                    } else {
                        // more dangerous method: try removing all relative indicators
                        while (path.indexOf('../') >= 0) {
                            path = path.replace('../', '');
                        }
                    }
                }
                path = path.replace('.json', '');

                json = Bento.assets.getJson(path);

                return json;
            },
            onLayer: function (layer, index) {
                var shouldMerge = false;
                currentLayer = index;
                if (layer.type === "tilelayer") {
                    if (!mergeLayers) {
                        // check per layer
                        if (onLayerMergeCheck) {
                            shouldMerge = onLayerMergeCheck(layer);
                        }
                        if (shouldMerge) {
                            currentSpriteLayer = 9999;
                        } else {
                            currentSpriteLayer = index;
                        }
                    } else {
                        currentSpriteLayer = 9999;
                    }
                }
                opacity = layer.opacity;
                if (onLayer) {
                    onLayer.call(tiled, layer, index);
                }
            },
            // we pass null if there is nothing to draw in order to skip the tile loop entirely
            onTile: layerSprites.drawn || !drawTiles ? null : function (tileX, tileY, tileSet, tileIndex, flipX, flipY, flipD) {
                // get destination position
                var x = tileX * tileWidth;
                var y = tileY * tileHeight;
                var destination = new Rectangle(x, y, tileWidth, tileHeight);

                // get source position
                var source = getSourceTile(tileSet, tileIndex);
                var layerIndex = currentLayer;

                // retrieve the corresponding image asset
                // there is a very high chance the url contains "images/" since the json files
                // should be stored in the "json/" folder and images in "images/"
                var imageUrl = tileSet.image;
                var assetName;
                var imageAsset;

                assetName = imageUrl.substring(imageUrl.indexOf('images/') + ('images/').length);
                assetName = assetName.replace('.png', '');
                imageAsset = Bento.assets.getImage(assetName);

                // draw on the layer
                layerSprites.drawTile(
                    currentSpriteLayer,
                    destination,
                    source,
                    imageAsset,
                    flipX,
                    flipY,
                    flipD,
                    opacity
                );

                if (onTile) {
                    onTile.call(tiled, tileX, tileY, tileSet, tileIndex, flipX, flipY, flipD, layerIndex);
                }
            },
            onObject: function (object, tileSet, tileIndex) {
                if (onObject) {
                    onObject.call(tiled, object, tileSet, tileIndex, currentLayer);
                }
                if (settings.spawnEntities) {
                    // note: we can pass currentLayer, as onLayer is synchronously called before onObject
                    spawnEntity(object, tileSet, tileIndex, currentLayer, function () {});
                }
            },
            onComplete: function () {
                var canvasLayers = layerSprites.layers;
                var layer;
                var l = canvasLayers.length;
                var i;
                var canvasSize = layerSprites.canvasSize;
                var spritesCountX = layerSprites.spritesCountX;
                var spritesCountY = layerSprites.spritesCountY;
                var makeEntity = function () {
                    var j = 0;
                    var canvas;
                    var sprite;
                    var entity;
                    var tiledLayer = json.layers[i];
                    for (j = 0; j < layer.length; ++j) {
                        canvas = layer[j];
                        sprite = new Sprite({
                            image: new PackedImage(canvas)
                        });
                        entity = new Entity({
                            z: 0,
                            name: tiledLayer ? tiledLayer.name || 'tiledLayer' : 'tiledLayer',
                            family: ['backgrounds'],
                            position: new Vector2(
                                offset.x + canvasSize.x * (j % spritesCountX),
                                offset.y + canvasSize.y * Math.floor(j / spritesCountX)
                            ),
                            components: [sprite]
                        });
                        // spawn background entities now?
                        if (settings.spawnBackground) {
                            Bento.objects.attach(entity);
                        }
                        backgrounds.push(entity);
                    }
                };

                for (i = 0; i < l; ++i) {
                    layer = canvasLayers[i];
                    if (layer) {
                        makeEntity();
                    }
                }

                // cache layers
                if (cacheCanvas) {
                    layerSprites.drawn = true;
                    cachedLayerSprites[assetName] = layerSprites;
                }

                if (onComplete) {
                    onComplete.call(tiled);
                }

                // call onSpawnComplete anyway, maybe no objects were spawned or synchronously spawned
                didLoopThrough = true;
                checkSpawnComplete();
            }
        });
        var didLoopThrough = false;
        var checkSpawnComplete = function () {
            if (didLoopThrough && entitiesSpawned === entitiesToSpawn && onSpawnComplete) {
                onSpawnComplete.call(tiled);
            }
        };
        // helper function to get the source in the image
        var getSourceTile = function (tileset, index) {
            var tilesetWidth = Math.floor(tileset.imagewidth / tileset.tilewidth);
            var tilesetHeight = Math.floor(tileset.imageheight / tileset.tileheight);

            return new Rectangle(
                (index % tilesetWidth) * tileset.tilewidth,
                Math.floor(index / tilesetWidth) * tileset.tileheight,
                tileset.tilewidth,
                tileset.tileheight
            );
        };
        // attempt to spawn object by tileproperty "module"
        // this is mainly for backwards compatibility of the old Tiled module
        var spawnEntity = function (object, tileSet, tileIndex, layerIndex, onSpawnCallback) {
            var tileproperties;
            var properties;
            var moduleName;
            var components = {};
            var tiledSettings = {};
            var require = {
                // paths to module and components
                paths: [],
                // parameters for respective module and components
                parameters: []
            };
            var x = object.x;
            var y = object.y;

            // Reads all custom properties and fishes out the components that need
            // to be attached to the entity. Also gets the component's parameters.
            var getComponents = function (props) {
                var prop = '';
                var name = '';
                var paramName = '';
                var dotIndex = -1;
                for (prop in props) {
                    // in order to pass a component through custom properties
                    // it needs to have 'component' somewhere in the name
                    if (prop.indexOf('component') > -1) {

                        dotIndex = prop.indexOf('.');
                        name = prop.slice(0, dotIndex === -1 ? undefined : dotIndex);

                        if (!components[name]) {
                            components[name] = {};
                        }

                        // Is it a parameter for the component?
                        if (dotIndex > -1) {
                            // component parameters have the same name as the component
                            // followed by a dot and the parameter name
                            paramName = prop.slice(dotIndex + 1);
                            components[name][paramName] = props[prop];
                        }
                        // Otherwise it's the path to the component
                        else {
                            components[name].pathToComponent = props[prop];
                        }
                    }
                }
            };
            var savePathsAndParameters = function () {
                var prop = '';
                var key = '';
                var component;
                var parameters = {};

                for (key in components) {
                    parameters = {
                        tiled: tiledSettings
                    };
                    component = components[key];

                    // make an object with all parameters for the component
                    for (prop in component) {
                        if (prop !== 'pathToComponent') {
                            parameters[prop] = component[prop];
                        }
                    }

                    // save paths to JS files and corresponding parameters
                    require.paths.push(component.pathToComponent);
                    require.parameters.push(Utils.cloneJson(parameters));
                }
            };
            var onRequire = function () {
                var Constructor = arguments[0];
                var instance = new Constructor(require.parameters[0]);
                var dimension = instance.dimension;
                var spriteOrigin = new Vector2(0, 0);
                var ii = 1;
                var iil = arguments.length;

                instance.getComponent('sprite', function (sprite) {
                    spriteOrigin = sprite.origin;
                });

                instance.position = new Vector2(
                    offset.x + x + spriteOrigin.x,
                    offset.y + y + (spriteOrigin.y - dimension.height)
                );

                // instantiate and attach all the specified components
                for (; ii < iil; ++ii) {
                    instance.attach(new arguments[ii](require.parameters[ii]));
                }

                // add to game
                if (attachEntities) {
                    Bento.objects.attach(instance);
                }
                entities.push(instance);

                entitiesSpawned += 1;

                if (onSpawn) {
                    onSpawn.call(tiled, instance, object, {
                        tileSet: tileSet,
                        moduleName: moduleName,
                        properties: properties
                    }, layerIndex);
                }
                onSpawnCallback.call(tiled, instance, object, {
                    tileSet: tileSet,
                    moduleName: moduleName,
                    properties: properties
                }, layerIndex);

                // cache module
                if (cacheModules) {
                    // caching the arguments as an actual array for safety
                    cachedModules[moduleName] = Array.prototype.slice.call(arguments);
                }

                checkSpawnComplete();
            };

            if (!object.gid) {
                // not an entity (it's a rectangle or other shape)
                return;
            }
            tileproperties = tileSet.tileproperties;
            if (!tileproperties) {
                return;
            }
            properties = tileproperties[tileIndex];
            if (!properties) {
                return;
            }
            moduleName = properties.module;
            if (!moduleName) {
                return;
            }
            // save path to module and its paramters
            require.paths.push(moduleName);
            tiledSettings = {
                position: new Vector2(x, y),
                tileSet: tileSet,
                tileIndex: tileIndex,
                tileProperties: properties,
                object: object,
                objectProperties: object.properties,
                jsonName: assetName // reference to current json name
            };
            require.parameters.push({
                tiled: tiledSettings
            });

            // search through the tileset's custom properties
            getComponents(properties);
            // search through any custom properties that were added to this instance of the object
            getComponents(object.properties);
            // save the paths to the components and save their parameters
            savePathsAndParameters();

            entitiesToSpawn += 1;

            if (cacheModules && cachedModules[moduleName]) {
                // use the cached module
                onRequire.apply(this, cachedModules[moduleName]);
            } else {
                // use require
                bento.require(require.paths, onRequire);
            }
        };
        var tiled = {
            name: settings.name || 'tiled',
            /**
             * Name of the Tiled JSON asset
             * @instance
             * @name assetName
             */
            assetName: assetName,
            /**
             * Map properties
             * @instance
             * @name mapProperties
             */
            mapProperties: mapProperties,
            /**
             * Reference to the Tiled JSON asset
             * @instance
             * @name json
             */
            json: json,
            /**
             * Rectangle with width and height of the Tiled map in pixels
             * @instance
             * @name dimension
             */
            dimension: new Rectangle(0, 0, mapSize.x, mapSize.y),
            /**
             * Array of all entities spawned
             * @instance
             * @name entities
             */
            entities: entities,
            /**
             * Array of all background entities spawned
             * @instance
             * @name backgrounds
             */
            backgrounds: backgrounds,
            /**
             * Object containing all drawn layers
             * @instance
             * @name layerImages
             */
            layerImages: layerSprites,
            /**
             * Clear cached modules if cacheModules is true (the cache is global, 
             * developer need to call this manually to clear the memory)
             * @instance
             * @name clearModuleCache
             */
            clearModuleCache: function () {
                cachedModules = {};
            },
            /**
             * Clear cached modules if cacheModules is true (the cache is global, 
             * developer need to call this manually to clear the memory)
             * @instance
             * @name clearCanvasCache
             */
            clearCanvasCache: function () {
                Utils.forEach(cachedLayerSprites, function (cachedLayerSprite) {
                    cachedLayerSprite.dispose();
                });
                cachedLayerSprites = {};
            },
            // clean up
            destroy: function () {
                if (cacheCanvas) {
                    layerSprites.dispose();
                }
            },
            spawnEntity: spawnEntity
        };

        tiledReader.read();

        return tiled;
    };

    return Tiled;
});
/**
 * A generic interpreter for Tiled map JSON files.
 * <br>Exports: Constructor
 * @module bento/tiledreader
 * @moduleName TiledReader
 * @param {Object} settings - Settings object
 * @param {String} settings.tiled - Tiled map JSON asset
 * @param {Function} settings.onExternalTileset - Called if an external tileset is needed, expects a JSON to be returned (the developer is expected to load the external tileset) Must be .json and not .tsx files.
 * @param {Function} [settings.onInit] - Callback on initial parsing, parameters: (tiledJson, externalTilesets)
 * @param {Function} [settings.onLayer] - Called when passing a layer, parameters: (layerJSON)
 * @param {Function} [settings.onTile] - Called when passing a tile, parameters: (tileX, tileY, tilesetJSON, tileIndex, flipX, flipY, flipDiagonal)
 * @param {Function} [settings.onObject] - Called when passing an object, parameters: (objectJSON, tilesetJSON, tileIndex) <br>Latter two if a gid is present in the objectJSON
 * @param {Function} [settings.onComplete] - Called when the reader is done
 * @param {Boolean} [settings.spawn] - Spawns entities
 * @returns Object
 */
bento.define('bento/tiledreader', [], function () {
    'use strict';
    var FLIPX = 0x80000000;
    var FLIPY = 0x40000000;
    var FLIPDIAGONAL = 0x20000000;

    var TiledReader = function (settings) {
        // cache callbacks
        var onExternalTileset = settings.onExternalTileset;
        var onInit = settings.onInit;
        var onLayer = settings.onLayer;
        var onTile = settings.onTile;
        var onObject = settings.onObject;
        var onComplete = settings.onComplete;

        // the tiled json
        var json = settings.tiled || {};

        // width and height in tiles
        var width = json.width || 0;
        var height = json.height || 0;

        // width and height of a single tile
        var tileWidth = json.tilewidth || 0;
        var tileHeight = json.tileheight || 0;

        // tilesets
        var tilesets = json.tilesets || [];
        var tilesetsCount = tilesets.length;
        var externalTilesets = {
            // "source": tileset JSON
        };
        var cachedFirstGids = [];

        // layers
        var layers = json.layers || [];
        var layersCount = layers.length;

        // load external tilesets
        var importTilesets = function () {
            var i;
            var l;
            var tileset;
            var source;

            // loop through all tilesets, look for external tilesets
            for (i = 0, l = tilesets.length; i < l; ++i) {
                tileset = tilesets[i];
                source = tileset.source;
                if (source) {
                    // to stay independent of any asset loader, this is loaded through a callback
                    externalTilesets[source] = onExternalTileset(source);
                }

                // meanwhile, cache all firstGids for faster lookups
                cachedFirstGids.push(tileset.firstgid);
            }
        };
        var decompress = function (layer) {
            var base64ToUint32array = function (base64) {
                var raw = window.atob(base64);
                var i;
                var len = raw.length;
                var bytes = new Uint8Array(len);
                for (i = 0; i < len; i++) {
                    bytes[i] = raw.charCodeAt(i);
                }
                var data = new Uint32Array(bytes.buffer, 0, len / 4);
                return data;
            };
            var encoding = layer.encoding;
            if (encoding === 'base64') {
                layer.data = base64ToUint32array(layer.data);
                layer.encoding = null;
            } else if (encoding) {
                // TODO: compression formats
                throw "ERROR: compression not supported. Please set Tile Layer Format to CSV in Tiled.";
            }
            return layer;
        };
        var loopLayers = function () {
            var i, il;
            var j, jl;
            var k, kl;
            var layers = json.layers;
            var layer;
            var layerData;
            var lh;
            var lw;
            var objects;
            var object;
            var properties;
            var layerId = 0;
            var type;
            var getTileset = function (gid) {
                var l,
                    tileset,
                    count = tilesetsCount,
                    current = null,
                    firstGid,
                    currentFirstGid;

                // loop through tilesets and find the highest firstgid that's
                // still lower or equal to the gid
                for (l = 0; l < count; ++l) {
                    firstGid = cachedFirstGids[l];
                    if (firstGid <= gid) {
                        current = tilesets[l];
                        currentFirstGid = firstGid;
                    }
                }

                // tileset is external?
                if (current.source) {
                    current = externalTilesets[current.source];
                }

                return {
                    tileSet: current,
                    firstGid: currentFirstGid
                };
            };
            var tileCallback = function (data, x, y) {
                // callback for every tile (stored layer.data)
                var gid = data[y * width + x];
                var tilesetData;
                var tileIndex;
                var flipX;
                var flipY;
                var flipDiagonal;

                // no tile
                if (gid === 0) {
                    return;
                }

                // read out the flags
                flipX = (gid & FLIPX);
                flipY = (gid & FLIPY);
                flipDiagonal = (gid & FLIPDIAGONAL);

                // clear flags
                gid &= ~(FLIPX | FLIPY | FLIPDIAGONAL);

                // get the corresponding tileset and tile index
                tilesetData = getTileset(gid);
                tileIndex = gid - tilesetData.firstGid;

                // callback
                onTile(x, y, tilesetData.tileSet, tileIndex, flipX, flipY, flipDiagonal);
            };
            var objectCallback = function (object) {
                var tileIndex;
                var tilesetData;
                var gid = object.gid;
                if (gid) {
                    // get the corresponding tileset and tile index
                    tilesetData = getTileset(gid);
                    tileIndex = gid - tilesetData.firstGid;
                    onObject(object, tilesetData.tileSet, tileIndex);
                } else {
                    // gid may not be present, in that case it's a rectangle or other shape
                    onObject(object);
                }
            };

            // loop through layers
            for (k = 0, kl = layers.length; k < kl; ++k) {
                layer = layers[k];
                type = layer.type;

                if (onLayer) {
                    onLayer(layer, k);
                }
                if (type === 'tilelayer' && onTile) {
                    // skip layer if invisible???
                    if (!layer.visible) {
                        continue;
                    }

                    // decompress data?
                    decompress(layer);

                    layerData = layer.data;

                    // loop through layer.data, which should be width * height in size
                    for (j = 0; j < height; ++j) {
                        for (i = 0; i < width; ++i) {
                            tileCallback(layerData, i, j);
                        }
                    }
                } else if (type === 'objectgroup' && onObject) {
                    objects = layer.objects || [];
                    il = objects.length;
                    for (i = 0; i < il; ++i) {
                        object = objects[i];

                        objectCallback(object);
                    }
                }
            }
            if (onComplete) {
                onComplete();
            }
        };

        importTilesets();

        if (onInit) {
            onInit(json, externalTilesets);
        }
        // loopLayers();

        return {
            /**
             * Read tiled JSON and loop through all layers, tiles and objects
             * @function
             * @instance
             * @name read
             */
            read: loopLayers
        };
    };

    return TiledReader;
});
/**
 * The Tween is an entity that performs an interpolation within a timeframe. The entity
 * removes itself after the tween ends.
 * Default tweens: linear, quadratic, squareroot, cubic, cuberoot, exponential, elastic, sin, cos
 * <br>Exports: Constructor
 * @module bento/tween
 * @moduleName Tween
 * @param {Object} settings - Settings object
 * @param {Number} settings.from - Starting value
 * @param {Number} settings.to - End value
 * @param {Number} settings.in - Time frame
 * @param {String} settings.ease - Choose between default tweens or see {@link http://easings.net/}
 * @param {Boolean} settings.wait - Do not immediately begin tween (default false)
 * @param {Number} [settings.decay] - For use in exponential and elastic tweens: decay factor (negative growth)
 * @param {Number} [settings.growth] - For use in exponential and elastic tweens: growth factor
 * @param {Number} [settings.oscillations] - For use in sin, cos and elastic tweens: number of oscillations
 * @param {Function} [settings.onCreate] - Called as soon as the tween is added to the object manager and before the delay (if any).
 * @param {Function} [settings.onStart] - Called before the first tween update and after a delay (if any).
 * @param {Function} [settings.onUpdate] - Called every tick during the tween lifetime. Callback parameters: (value, time)
 * @param {Function} [settings.onComplete] - Called when tween ends
 * @param {Number} [settings.id] - Adds an id property to the tween. Useful when spawning tweens in a loop (remember that functions form closures)
 * @param {Number} [settings.delay] - Wait an amount of ticks before starting
 * @param {Boolean} [settings.applyOnDelay] - Perform onUpdate even during delay
 * @param {Boolean} [settings.stay] - Never complete the tween (only use if you know what you're doing)
 * @param {Boolean} [settings.updateWhenPaused] - Continue tweening even when the game is paused (optional) NOTE: tweens automatically copy the current pause level if this is not set
 * @param {Boolean} [settings.ignoreGameSpeed] - Run tween at normal speed (optional)
 * @returns Entity
 * @snippet Tween|constructor
Tween({
    from: ${1:0},
    to: ${2:1},
    in: ${3:60},
    delay: ${4:0},
    applyOnDelay: ${5:0},
    ease: '${6:linear}',
    decay: ${7:1},
    oscillations: ${8:1},
    onStart: function () {},
    onUpdate: function (v, t) {
        ${9}
    },
    onComplete: function () {
        ${10}
    }
});
 */

// Deprecated parameters
// * @param {Number} [settings.alpha] - For use in exponential y=exp(αt) or elastic y=exp(αt)*cos(βt)
// * @param {Number} [settings.beta] - For use in elastic y=exp(αt)*cos(βt)
bento.define('bento/tween', [
    'bento',
    'bento/math/vector2',
    'bento/utils',
    'bento/entity'
], function (Bento, Vector2, Utils, Entity) {
    'use strict';
    /**
     * Interpolations (3rd party)
     */
    var robbertPenner = new Object({
        // t: current time, b: begInnIng value, c: change In value, d: duration
        easeInQuad: function (t, b, c, d) {
            return c * (t /= d) * t + b;
        },
        easeOutQuad: function (t, b, c, d) {
            return -c * (t /= d) * (t - 2) + b;
        },
        easeInOutQuad: function (t, b, c, d) {
            if ((t /= d / 2) < 1) return c / 2 * t * t + b;
            return -c / 2 * ((--t) * (t - 2) - 1) + b;
        },
        easeInCubic: function (t, b, c, d) {
            return c * (t /= d) * t * t + b;
        },
        easeOutCubic: function (t, b, c, d) {
            return c * ((t = t / d - 1) * t * t + 1) + b;
        },
        easeInOutCubic: function (t, b, c, d) {
            if ((t /= d / 2) < 1) return c / 2 * t * t * t + b;
            return c / 2 * ((t -= 2) * t * t + 2) + b;
        },
        easeInQuart: function (t, b, c, d) {
            return c * (t /= d) * t * t * t + b;
        },
        easeOutQuart: function (t, b, c, d) {
            return -c * ((t = t / d - 1) * t * t * t - 1) + b;
        },
        easeInOutQuart: function (t, b, c, d) {
            if ((t /= d / 2) < 1) return c / 2 * t * t * t * t + b;
            return -c / 2 * ((t -= 2) * t * t * t - 2) + b;
        },
        easeInQuint: function (t, b, c, d) {
            return c * (t /= d) * t * t * t * t + b;
        },
        easeOutQuint: function (t, b, c, d) {
            return c * ((t = t / d - 1) * t * t * t * t + 1) + b;
        },
        easeInOutQuint: function (t, b, c, d) {
            if ((t /= d / 2) < 1) return c / 2 * t * t * t * t * t + b;
            return c / 2 * ((t -= 2) * t * t * t * t + 2) + b;
        },
        easeInSine: function (t, b, c, d) {
            return -c * Math.cos(t / d * (Math.PI / 2)) + c + b;
        },
        easeOutSine: function (t, b, c, d) {
            return c * Math.sin(t / d * (Math.PI / 2)) + b;
        },
        easeInOutSine: function (t, b, c, d) {
            return -c / 2 * (Math.cos(Math.PI * t / d) - 1) + b;
        },
        easeInExpo: function (t, b, c, d) {
            return (t === 0) ? b : c * Math.pow(2, 10 * (t / d - 1)) + b;
        },
        easeOutExpo: function (t, b, c, d) {
            return (t === d) ? b + c : c * (-Math.pow(2, -10 * t / d) + 1) + b;
        },
        easeInOutExpo: function (t, b, c, d) {
            if (t === 0) return b;
            if (t === d) return b + c;
            if ((t /= d / 2) < 1) return c / 2 * Math.pow(2, 10 * (t - 1)) + b;
            return c / 2 * (-Math.pow(2, -10 * --t) + 2) + b;
        },
        easeInCirc: function (t, b, c, d) {
            return -c * (Math.sqrt(1 - (t /= d) * t) - 1) + b;
        },
        easeOutCirc: function (t, b, c, d) {
            return c * Math.sqrt(1 - (t = t / d - 1) * t) + b;
        },
        easeInOutCirc: function (t, b, c, d) {
            if ((t /= d / 2) < 1) return -c / 2 * (Math.sqrt(1 - t * t) - 1) + b;
            return c / 2 * (Math.sqrt(1 - (t -= 2) * t) + 1) + b;
        },
        easeInElastic: function (t, b, c, d) {
            var s = 1.70158,
                p = 0,
                a = c;
            if (t === 0) return b;
            if ((t /= d) === 1) return b + c;
            if (!p) p = d * 0.3;
            if (a < Math.abs(c)) {
                a = c;
                s = p / 4;
            } else s = p / (2 * Math.PI) * Math.asin(c / a);
            return -(a * Math.pow(2, 10 * (t -= 1)) * Math.sin((t * d - s) * (2 * Math.PI) / p)) + b;
        },
        easeOutElastic: function (t, b, c, d) {
            var s = 1.70158,
                p = 0,
                a = c;
            if (t === 0) return b;
            if ((t /= d) === 1) return b + c;
            if (!p) p = d * 0.3;
            if (a < Math.abs(c)) {
                a = c;
                s = p / 4;
            } else s = p / (2 * Math.PI) * Math.asin(c / a);
            return a * Math.pow(2, -10 * t) * Math.sin((t * d - s) * (2 * Math.PI) / p) + c + b;
        },
        easeInOutElastic: function (t, b, c, d) {
            var s = 1.70158,
                p = 0,
                a = c;
            if (t === 0) return b;
            if ((t /= d / 2) === 2) return b + c;
            if (!p) p = d * (0.3 * 1.5);
            if (a < Math.abs(c)) {
                a = c;
                s = p / 4;
            } else s = p / (2 * Math.PI) * Math.asin(c / a);
            if (t < 1) return -0.5 * (a * Math.pow(2, 10 * (t -= 1)) * Math.sin((t * d - s) * (2 * Math.PI) / p)) + b;
            return a * Math.pow(2, -10 * (t -= 1)) * Math.sin((t * d - s) * (2 * Math.PI) / p) * 0.5 + c + b;
        },
        easeInBack: function (t, b, c, d, s) {
            if (s === undefined) s = 1.70158;
            return c * (t /= d) * t * ((s + 1) * t - s) + b;
        },
        easeOutBack: function (t, b, c, d, s) {
            if (s === undefined) s = 1.70158;
            return c * ((t = t / d - 1) * t * ((s + 1) * t + s) + 1) + b;
        },
        easeInOutBack: function (t, b, c, d, s) {
            if (s === undefined) s = 1.70158;
            if ((t /= d / 2) < 1) return c / 2 * (t * t * (((s *= (1.525)) + 1) * t - s)) + b;
            return c / 2 * ((t -= 2) * t * (((s *= (1.525)) + 1) * t + s) + 2) + b;
        },
        easeInBounce: function (t, b, c, d) {
            return c - this.easeOutBounce(d - t, 0, c, d) + b;
        },
        easeOutBounce: function (t, b, c, d) {
            if ((t /= d) < (1 / 2.75)) {
                return c * (7.5625 * t * t) + b;
            } else if (t < (2 / 2.75)) {
                return c * (7.5625 * (t -= (1.5 / 2.75)) * t + 0.75) + b;
            } else if (t < (2.5 / 2.75)) {
                return c * (7.5625 * (t -= (2.25 / 2.75)) * t + 0.9375) + b;
            } else {
                return c * (7.5625 * (t -= (2.625 / 2.75)) * t + 0.984375) + b;
            }
        },
        easeInOutBounce: function (t, b, c, d) {
            if (t < d / 2) return this.easeInBounce(t * 2, 0, c, d) * 0.5 + b;
            return this.easeOutBounce(t * 2 - d, 0, c, d) * 0.5 + c * 0.5 + b;
        }
    });
    /**
     * Interpolations
     */
    var interpolations = new Object({
        linear: function (s, e, t, alpha, beta) {
            return (e - s) * t + s;
        },
        quadratic: function (s, e, t, alpha, beta) {
            return (e - s) * t * t + s;
        },
        squareroot: function (s, e, t, alpha, beta) {
            return (e - s) * Math.pow(t, 0.5) + s;
        },
        cubic: function (s, e, t, alpha, beta) {
            return (e - s) * t * t * t + s;
        },
        cuberoot: function (s, e, t, alpha, beta) {
            return (e - s) * Math.pow(t, 1 / 3) + s;
        },
        exponential: function (s, e, t, alpha, beta) {
            //takes alpha as growth/damp factor
            return (e - s) / (Math.exp(alpha) - 1) * Math.exp(alpha * t) + s - (e - s) / (Math.exp(alpha) - 1);
        },
        elastic: function (s, e, t, alpha, beta) {
            //alpha=growth factor, beta=wavenumber
            return (e - s) / (Math.exp(alpha) - 1) * Math.cos(beta * t * 2 * Math.PI) * Math.exp(alpha * t) + s - (e - s) / (Math.exp(alpha) - 1);
        },
        sin: function (s, e, t, alpha, beta) {
            //s=offset, e=amplitude, alpha=wavenumber
            return s + e * Math.sin(alpha * t * 2 * Math.PI);
        },
        cos: function (s, e, t, alpha, beta) {
            //s=offset, e=amplitude, alpha=wavenumber
            return s + e * Math.cos(alpha * t * 2 * Math.PI);
        }
    });

    /**
     * Generate an interpolation function based on ease and type of start/end values (Numbers or Vector2)
     */
    var generateInterpolation = function (ease, startVal, endVal) {
        // generate the correct interpolation function
        var fn = interpolations[ease];
        if (startVal.isVector2 && endVal.isVector2) {
            // as vectors
            if (fn) {
                return function (s, e, t, alpha, beta) {
                    return new Vector2(
                        fn(s.x, e.x, t, alpha, beta),
                        fn(s.y, e.y, t, alpha, beta)
                    );
                };
            } else {
                fn = robbertPenner[ease];
                return function (s, e, t, alpha, beta) {
                    return new Vector2(
                        fn(t, s.x, e.x - s.x, 1),
                        fn(t, s.y, e.y - s.y, 1)
                    );
                };
            }
        } else {
            // number output
            if (fn) {
                return function (s, e, t, alpha, beta) {
                    return fn(s, e, t, alpha, beta);
                };
            } else {
                fn = robbertPenner[ease];
                return function (s, e, t, alpha, beta) {
                    return fn(t, s, e - s, 1);
                };
            }
        }
    };

    /**
     * Tween Behavior, can be used standalone or as behavior attached to Entity
     */
    var TweenBehavior = function (settings) {
        /* settings = {
            from: Number
            to: Number
            in: Number
            ease: String
            alpha: Number (optional)
            beta: Number (optional)
            stay: Boolean (optional)
            do: Gunction (value, time) {} (optional)
            onComplete: function () {} (optional)
            id: Number (optional),
            updateWhenPaused: Boolean (optional)
            ignoreGameSpeed: Boolean (optional)
        }*/
        var time = 0;
        var running = !settings.wait;
        var onUpdate = settings.onUpdate || settings.do;
        var onComplete = settings.onComplete;
        var onCreate = settings.onCreate;
        var onStart = settings.onStart;
        var applyOnDelay = settings.applyOnDelay;
        var hasStarted = false;
        var ease = settings.ease || 'linear';
        var startVal = settings.from || 0;
        var delay = settings.delay || 0;
        var delayTimer = 0;
        var endVal = Utils.isDefined(settings.to) ? settings.to : 1;
        var deltaT = settings.in || 1;
        var alpha = Utils.isDefined(settings.alpha) ? settings.alpha : 1;
        var beta = Utils.isDefined(settings.beta) ? settings.beta : 1;
        var ignoreGameSpeed = settings.ignoreGameSpeed;
        var stay = settings.stay;
        var autoResumeTimer = -1;
        // either the tweenBehavior or its parent entity
        var tweenSubject;
        // interpolation funciton to be generated
        var interpolate = generateInterpolation(ease, startVal, endVal);
        var tweenBehavior = new Object({
            z: 0,
            name: 'tweenBehavior',
            start: function (data) {
                if (onCreate) {
                    onCreate.apply(tweenSubject);
                }
            },
            update: function (data) {
                //if an autoresume timer is running, decrease it and resume when it is done
                if (--autoResumeTimer === 0) {
                    tweenBehavior.resume();
                }
                if (!running) {
                    return;
                }
                if (delayTimer < delay) {
                    if (ignoreGameSpeed) {
                        delayTimer += 1;
                    } else {
                        delayTimer += data.speed;
                    }
                    // run onUpdate before start
                    if (applyOnDelay && onUpdate) {
                        onUpdate.apply(tweenSubject, [interpolate(
                            startVal,
                            endVal,
                            0,
                            alpha,
                            beta
                        ), 0]);
                    }
                    return;
                }
                if (ignoreGameSpeed) {
                    time += 1;
                } else {
                    time += data.speed;
                }
                // run onStart once
                if (!hasStarted) {
                    hasStarted = true;
                    if (onStart) {
                        onStart.apply(tweenSubject);
                    }
                }
                // run update
                if (onUpdate) {
                    onUpdate.apply(tweenSubject, [interpolate(
                        startVal,
                        endVal,
                        time / deltaT,
                        alpha,
                        beta
                    ), time]);
                }
                // end
                if (time >= deltaT && !stay) {
                    if (time > deltaT && onUpdate) {
                        //the tween didn't end neatly, so run onUpdate once more with a t of 1
                        onUpdate.apply(tweenSubject, [interpolate(
                            startVal,
                            endVal,
                            1,
                            alpha,
                            beta
                        ), time]);
                    }
                    if (onComplete) {
                        onComplete.apply(tweenSubject);
                    }

                    tweenBehavior.removeSelf();
                }
            },
            attached: function (data) {
                if (data.entity) {
                    // an entity attached this behavior
                    tweenSubject = data.entity;
                }
            },
            /**
             * Start the tween. Only call if you used stop() before.
             * @function
             * @instance
             * @returns {Entity} Returns self
             * @name begin
             * @snippet #Tween.begin|Tween
            begin();
             */
            begin: function () {
                time = 0;
                running = true;
                return tweenSubject;
            },
            /**
             * Stops the tween (note that the entity isn't removed).
             * @function
             * @instance
             * @returns {Entity} Returns self
             * @name stop
             * @snippet #Tween.stop|Tween
            stop();
             */
            stop: function () {
                time = 0;
                running = false;
                return tweenSubject;
            },
            /**
             * Pauses the tween. The tween will resume itself after a certain duration if provided.
             * @function
             * @instance
             * @param {Number} [duration] - time after which to autoresume. If not provided the tween is paused indefinitely.
             * @returns {Entity} Returns self
             * @name pause
             */
            pause: function (duration) {
                running = false;
                //if a duration is provided, resume the tween after that duration.
                if (duration) {
                    autoResumeTimer = duration;
                }
                return tweenSubject;
            },
            /**
             * Resumes the tween.
             * @function
             * @instance
             * @returns {Entity} Returns self
             * @name resume
             */
            resume: function () {
                return tweenBehavior.begin();
            },
            /**
             * Removes the tweenbehavior from tween collection or from parent Entity
             * @function
             * @instance
             * @name removeSelf
             */
            removeSelf: function () {
                if (tweenSubject === tweenBehavior) {
                    Bento.objects.remove(tweenBehavior);
                } else if (tweenSubject && tweenSubject.isEntity) {
                    tweenSubject.remove(tweenBehavior);
                }
            }
        });

        tweenSubject = tweenBehavior;

        // convert decay and growth to alpha
        if (Utils.isDefined(settings.decay)) {
            alpha = -settings.decay;
        }
        if (Utils.isDefined(settings.growth)) {
            alpha = settings.growth;
        }
        if (Utils.isDefined(settings.oscillations)) {
            beta = settings.oscillations;
            if (settings.ease === 'sin' || settings.ease === 'cos') {
                alpha = settings.oscillations;
            }
        }

        // Assuming that when a tween is created when the game is paused,
        // one wants to see the tween move during that pause
        if (!Utils.isDefined(settings.updateWhenPaused)) {
            tweenBehavior.updateWhenPaused = Bento.objects.isPaused();
        } else {
            tweenBehavior.updateWhenPaused = settings.updateWhenPaused;
        }

        // tween automatically starts
        if (running) {
            tweenBehavior.begin();
        }

        return tweenBehavior;
    };

    /**
     * Main Tween module, applied immediately
     */
    var Tween = function (settings) {
        // this is no longer an entity, to remove the overhead an entity has
        // if developer wants to use the tween as an Entity, construct a Tween.TweenBehavior and
        // attach to an Entity
        var tweenBehavior = new TweenBehavior(settings);
        Bento.objects.attach(tweenBehavior);
        return tweenBehavior;
    };

    // Behaviour constructor
    Tween.TweenBehavior = TweenBehavior;

    // enums
    Tween.LINEAR = 'linear';
    Tween.QUADRATIC = 'quadratic';
    Tween.CUBIC = 'cubic';
    Tween.SQUAREROOT = 'squareroot';
    Tween.CUBEROOT = 'cuberoot';
    Tween.EXPONENTIAL = 'exponential';
    Tween.ELASTIC = 'elastic';
    Tween.SIN = 'sin';
    Tween.COS = 'cos';
    Tween.EASEINQUAD = 'easeInQuad';
    Tween.EASEOUTQUAD = 'easeOutQuad';
    Tween.EASEINOUTQUAD = 'easeInOutQuad';
    Tween.EASEINCUBIC = 'easeInCubic';
    Tween.EASEOUTCUBIC = 'easeOutCubic';
    Tween.EASEINOUTCUBIC = 'easeInOutCubic';
    Tween.EASEINQUART = 'easeInQuart';
    Tween.EASEOUTQUART = 'easeOutQuart';
    Tween.EASEINOUTQUART = 'easeInOutQuart';
    Tween.EASEINQUINT = 'easeInQuint';
    Tween.EASEOUTQUINT = 'easeOutQuint';
    Tween.EASEINOUTQUINT = 'easeInOutQuint';
    Tween.EASEINSINE = 'easeInSine';
    Tween.EASEOUTSINE = 'easeOutSine';
    Tween.EASEINOUTSINE = 'easeInOutSine';
    Tween.EASEINEXPO = 'easeInExpo';
    Tween.EASEOUTEXPO = 'easeOutExpo';
    Tween.EASEINOUTEXPO = 'easeInOutExpo';
    Tween.EASEINCIRC = 'easeInCirc';
    Tween.EASEOUTCIRC = 'easeOutCirc';
    Tween.EASEINOUTCIRC = 'easeInOutCirc';
    Tween.EASEINELASTIC = 'easeInElastic';
    Tween.EASEOUTELASTIC = 'easeOutElastic';
    Tween.EASEINOUTELASTIC = 'easeInOutElastic';
    Tween.EASEINBACK = 'easeInBack';
    Tween.EASEOUTBACK = 'easeOutBack';
    Tween.EASEINOUTBACK = 'easeInOutBack';
    Tween.EASEINBOUNCE = 'easeInBounce';
    Tween.EASEOUTBOUNCE = 'easeOutBounce';
    Tween.EASEINOUTBOUNCE = 'easeInOutBounce';

    // expose interpolations
    Tween.interpolations = interpolations;
    Tween.interpolationsRP = robbertPenner;

    return Tween;
});
/**
 * A wrapper for HTML images, holds data for image atlas. Bento renderers only work with PackedImage and not plain
 * HTML Image elements. This allows for easy transitions to using, for example, TexturePacker.
 * (That's why it's called PackedImage, for a lack of better naming).
 * If you plan to use a HTML Canvas as image source, always remember to wrap it in a PackedImage.
 * <br>Exports: Constructor
 * @module bento/packedimage
 * @moduleName PackedImage
 * @param {HTMLImageElement} image - HTML Image Element or HTML Canvas Element
 * @param {Rectangle} frame - Frame boundaries in the image
 * @returns {Rectangle} rectangle - Returns a rectangle with additional image property
 * @returns {HTMLImage} rectangle.image - Reference to the image
 * @snippet PackedImage|constructor
PackedImage(${1:image});
 * @snippet PackedImage|frame
PackedImage(${1:image}, new Rectangle(${2:0}, ${3:0}, ${4:32}, ${5:32}));
 */
bento.define('bento/packedimage', [
    'bento/math/rectangle'
], function (Rectangle) {
    return function (image, frame) {
        var rectangle = frame ? new Rectangle(frame.x, frame.y, frame.w, frame.h) :
            new Rectangle(0, 0, image.width, image.height);
        rectangle.image = image;
        return rectangle;
    };
});
/*
 * Time profiler
 * @moduleName Profiler
 */
bento.define('bento/profiler', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/eventsystem',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    EventSystem,
    Utils,
    Tween
) {
    'use strict';
    var ticTime = 0;
    var startTime = 0;
    var totalTime = 0;
    var times = {};
    var totals = {};
    var measures = {};
    var measurements = 0;
    var hasStarted = false;
    var start = function () {
        hasStarted = true;
        startTime = window.performance.now();
    };
    var stop = function () {
        totalTime += window.performance.now() - startTime;
        measurements += 1;

        if (this.reportAfter && measurements > this.reportAfter) {
            measurements = 0;
            this.report();
        }
        hasStarted = false;
    };
    var report = function () {
        var key;
        console.log('== Report for time spent ==');
        console.log('Total time:', totalTime.toFixed(2) + 'ms');
        for (key in totals) {
            if (!totals.hasOwnProperty(key)) {
                continue;
            }

            console.log(
                key,
                '\n  ' + totals[key].toFixed(2) + 'ms',
                '\n  ' + (totals[key] / totalTime * 100).toFixed(0) + '%',
                '\n  ' + measures[key] + ' tics'
            );
        }
    };
    var tic = function (name) {
        if (!hasStarted) {
            return;
        }
        if (name) {
            times[name] = window.performance.now();
            totals[name] = totals[name] || 0;
            measures[name] = measures[name] || 0;
        } else {
            ticTime = window.performance.now();
        }
    };
    var toc = function (name, log) {
        if (!hasStarted) {
            return;
        }
        if (log) {
            if (name) {
                console.log(name, window.performance.now() - times[name]);
            } else {
                console.log(window.performance.now() - ticTime);
            }
        }
        totals[name] += window.performance.now() - times[name];
        measures[name] += 1;
    };

    return {
        reportAfter: 10, // number of measurements to report after
        start: start,
        stop: stop,
        report: report,
        tic: tic,
        toc: toc
    };
});
/*
 * Base functions for renderer. Has many equivalent functions to a canvas context.
 * <br>Exports: Constructor
 * @module bento/renderer
 * @moduleName Renderer
 */
bento.define('bento/renderer', [
    'bento/utils'
], function (Utils) {
    return function (rendererName, canvas, settings, callback) {
        var module = {
            save: function () {},
            restore: function () {},
            setTransform: function (a, b, c, d, tx, ty) {},
            translate: function () {},
            scale: function (x, y) {},
            rotate: function (angle) {},
            fillRect: function (color, x, y, w, h) {},
            fillCircle: function (color, x, y, radius) {},
            strokeRect: function (color, x, y, w, h) {},
            drawLine: function (color, ax, ay, bx, by, width) {},
            drawImage: function (spriteImage, sx, sy, sw, sh, x, y, w, h) {},
            begin: function () {},
            flush: function () {},
            setColor: function () {},
            getOpacity: function () {},
            setOpacity: function () {},
            createSurface: function () {},
            setContext: function () {},
            restoreContext: function () {}
        };
        bento.require([rendererName], function (renderer) {
            Utils.extend(module, renderer(canvas, settings), true);
            callback(module);
        });
    };
});
/**
 * Canvas 2d renderer
 * @copyright (C) 2015 LuckyKat
 * @moduleName Canvas2DRenderer
 */
bento.define('bento/renderers/canvas2d', [
    'bento/utils',
    'bento/math/transformmatrix'
], function (
    Utils,
    TransformMatrix
) {
    return function (canvas, settings) {
        var context = canvas.getContext('2d');
        var original = context;
        var pixelSize = settings.pixelSize || 1;
        var matrix = new TransformMatrix();
        var matrices = [];
        var renderer = {
            name: 'canvas2d',
            save: function () {
                matrices.push(matrix.clone());
            },
            restore: function () {
                var lastMatrix = matrices.pop();
                lastMatrix.copyInto(matrix);
                applyTransform();
            },
            setTransform: function (a, b, c, d, tx, ty) {
                matrix.a = a;
                matrix.b = b;
                matrix.c = c;
                matrix.d = d;
                matrix.tx = tx;
                matrix.ty = ty;
                // immediately apply to current transform
                applyTransform();
            },
            getTransform: function () {
                return matrix;
            },
            translate: function (x, y) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.translate(x, y));
                applyTransform();
            },
            scale: function (x, y) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.scale(x, y));
                applyTransform();
            },
            rotate: function (angle) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.rotate(angle));
                applyTransform();
            },
            fillRect: function (colorArray, x, y, w, h) {
                var colorStr = getColor(colorArray),
                    oldOpacity = context.globalAlpha;
                if (colorArray[3] !== 1) {
                    context.globalAlpha *= colorArray[3];
                }
                context.fillStyle = colorStr;
                context.fillRect(x, y, w, h);
                if (colorArray[3] !== 1) {
                    context.globalAlpha = oldOpacity;
                }
            },
            fillCircle: function (colorArray, x, y, radius) {
                var colorStr = getColor(colorArray),
                    oldOpacity = context.globalAlpha;
                if (colorArray[3] !== 1) {
                    context.globalAlpha *= colorArray[3];
                }
                context.fillStyle = colorStr;
                context.beginPath();
                context.arc(x, y, radius, 0, Math.PI * 2);
                context.fill();
                context.closePath();
                if (colorArray[3] !== 1) {
                    context.globalAlpha = oldOpacity;
                }
            },
            strokeRect: function (colorArray, x, y, w, h, lineWidth) {
                var colorStr = getColor(colorArray),
                    oldOpacity = context.globalAlpha;
                if (colorArray[3] !== 1) {
                    context.globalAlpha *= colorArray[3];
                }
                context.lineWidth = lineWidth || 0;
                context.strokeStyle = colorStr;
                context.strokeRect(x, y, w, h);
                if (colorArray[3] !== 1) {
                    context.globalAlpha = oldOpacity;
                }
            },
            strokeCircle: function (colorArray, x, y, radius, sAngle, eAngle, lineWidth) {
                var colorStr = getColor(colorArray),
                    oldOpacity = context.globalAlpha;

                sAngle = sAngle || 0;
                eAngle = eAngle || 0;

                if (colorArray[3] !== 1) {
                    context.globalAlpha *= colorArray[3];
                }
                context.strokeStyle = colorStr;
                context.lineWidth = lineWidth || 0;
                context.beginPath();
                context.arc(x, y, radius, sAngle, eAngle, false);
                context.stroke();
                context.closePath();
            },
            drawLine: function (colorArray, ax, ay, bx, by, width) {
                var colorStr = getColor(colorArray),
                    oldOpacity = context.globalAlpha;
                if (colorArray[3] !== 1) {
                    context.globalAlpha *= colorArray[3];
                }
                if (!Utils.isDefined(width)) {
                    width = 1;
                }

                context.strokeStyle = colorStr;
                context.lineWidth = width;

                context.beginPath();
                context.moveTo(ax, ay);
                context.lineTo(bx, by);
                context.stroke();
                context.closePath();

                if (colorArray[3] !== 1) {
                    context.globalAlpha = oldOpacity;
                }
            },
            drawImage: function (packedImage, sx, sy, sw, sh, x, y, w, h) {
                context.drawImage(packedImage.image, packedImage.x + sx, packedImage.y + sy, sw, sh, x, y, w, h);
            },
            getOpacity: function () {
                return context.globalAlpha;
            },
            setOpacity: function (value) {
                context.globalAlpha = value;
            },
            createSurface: function (width, height) {
                var newCanvas = document.createElement('canvas'),
                    newContext;

                newCanvas.width = width;
                newCanvas.height = height;

                newContext = newCanvas.getContext('2d');

                return {
                    canvas: newCanvas,
                    context: newContext
                };
            },
            setContext: function (ctx) {
                context = ctx;
            },
            restoreContext: function () {
                context = original;
            },
            getContext: function () {
                return context;
            },
            begin: function () {
                if (context === original && pixelSize !== 1) {
                    renderer.save();
                    renderer.scale(pixelSize, pixelSize);
                }
            },
            flush: function () {
                if (context === original && pixelSize !== 1) {
                    renderer.restore();
                }
            }
        };
        var getColor = function (colorArray) {
            var colorStr = '#';
            colorStr += ('00' + Math.floor(colorArray[0] * 255).toString(16)).slice(-2);
            colorStr += ('00' + Math.floor(colorArray[1] * 255).toString(16)).slice(-2);
            colorStr += ('00' + Math.floor(colorArray[2] * 255).toString(16)).slice(-2);
            return colorStr;
        };
        var applyTransform = function () {
            // apply transform matrix to context
            context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty);
        };

        return renderer;
    };
});
/**
 * Renderer using PIXI by GoodBoyDigital
 * @moduleName PixiRenderer
 */
bento.define('bento/renderers/pixi', [
    'bento',
    'bento/utils',
    'bento/math/transformmatrix',
    'bento/renderers/canvas2d'
], function (Bento, Utils, TransformMatrix, Canvas2d) {
    var PIXI = window.PIXI;
    var PixiRenderer = function (canvas, settings) {
        var gl;
        var canWebGl = (function () {
            // try making a canvas
            try {
                gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                return !!window.WebGLRenderingContext;
            } catch (e) {
                return false;
            }
        })();
        var matrix;
        var Matrix;
        var matrices = [];
        var alpha = 1;
        var color = 0xFFFFFF;
        var renderer;
        var cocoonScale = 1;
        var pixelSize = settings.pixelSize || 1;
        var pixiMatrix = new PIXI.Matrix();
        var stage = new PIXI.Container();
        var pixiRenderer = {
            name: 'pixi',
            init: function () {

            },
            destroy: function () {},
            save: function () {
                matrices.push(matrix.clone());
            },
            restore: function () {
                matrix = matrices.pop();
            },
            setTransform: function (a, b, c, d, tx, ty) {
                matrix.a = a;
                matrix.b = b;
                matrix.c = c;
                matrix.d = d;
                matrix.tx = tx;
                matrix.ty = ty;
            },
            getTransform: function () {
                return matrix;
            },
            translate: function (x, y) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.translate(x, y));
            },
            scale: function (x, y) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.scale(x, y));
            },
            rotate: function (angle) {
                var transform = new TransformMatrix();
                matrix.multiplyWith(transform.rotate(angle));
            },
            fillRect: function (color, x, y, w, h) {
                return;
            },
            fillCircle: function (color, x, y, radius) {
                return;
            },
            strokeRect: function (color, x, y, w, h, lineWidth) {
                return;
            },
            strokeCircle: function (color, x, y, radius, sAngle, eAngle, lineWidth) {
                return;
            },
            drawLine: function (color, ax, ay, bx, by, width) {
                return;
            },
            drawImage: function (packedImage, sx, sy, sw, sh, x, y, w, h) {
                return;
            },
            begin: function () {
                if (pixelSize !== 1 || Utils.isCocoonJs()) {
                    this.save();
                    this.scale(pixelSize * cocoonScale, pixelSize * cocoonScale);
                }
            },
            flush: function () {
                renderer.render(stage);
                while (stage.children.length) {
                    // clean up
                    stage.removeChild(stage.children[0]);
                }

                if (pixelSize !== 1 || Utils.isCocoonJs()) {
                    this.restore();
                }
            },
            getOpacity: function () {
                return alpha;
            },
            setOpacity: function (value) {
                alpha = value;
            },
            render: function (displayObject) {
                this.drawPixi(displayObject);
            },
            /*
             * Pixi only feature: draws any pixi displayObject
             */
            drawPixi: function (displayObject) {
                // set piximatrix to current transform matrix
                pixiMatrix.a = matrix.a;
                pixiMatrix.b = matrix.b;
                pixiMatrix.c = matrix.c;
                pixiMatrix.d = matrix.d;
                pixiMatrix.tx = matrix.tx;
                pixiMatrix.ty = matrix.ty;

                stage.addChild(displayObject);
                displayObject.transform.setFromMatrix(pixiMatrix);
                displayObject.alpha = alpha;
            },
            getContext: function () {
                return gl;
            },
            getPixiRenderer: function () {
                return renderer;
            },
            // pixi specific: update the webgl view, needed if the canvas changed size
            updateSize: function () {
                renderer.resize(canvas.width, canvas.height);
            }
        };

        if (canWebGl && Utils.isDefined(window.PIXI)) {
            // init pixi
            // Matrix = PIXI.Matrix;
            matrix = new TransformMatrix();
            // additional scale
            if (Utils.isCocoonJs()) {
                cocoonScale = Utils.getScreenSize().width * window.devicePixelRatio / canvas.width;
                canvas.width *= cocoonScale;
                canvas.height *= cocoonScale;
            }
            renderer = new PIXI.Renderer({
                view: canvas,
                backgroundColor: 0x000000,
                clearBeforeRender: false,
                antialias: Bento.getAntiAlias()
            });
            return pixiRenderer;
        } else {
            if (!window.PIXI) {
                console.log('WARNING: PIXI library is missing, reverting to Canvas2D renderer');
            } else if (!canWebGl) {
                console.log('WARNING: WebGL not available, reverting to Canvas2D renderer');
            }
            return Canvas2d(canvas, settings);
        }
    };
    return PixiRenderer;
});
/**
 * Transform module
 * @moduleName Transform
 */
bento.define('bento/transform', [
    'bento',
    'bento/math/vector2',
    'bento/math/transformmatrix',
], function (
    Bento,
    Vector2,
    Matrix
) {
    'use strict';
    var twoPi = Math.PI * 2;

    var Transform = function (entity) {
        if (!(this instanceof Transform)) {
            return new Transform(entity);
        }
        this.worldTransform = new Matrix();
        this.localTransform = new Matrix();
        this.entity = entity;

        // cache values
        this.oldAlpha = 1;        

        // additional transforms
        this.x = 0;
        this.y = 0;
        this.visible = true; // only checked by entity
    };

    Transform.prototype.draw = function (data) {
        var currentTransform;
        var worldTransform = this.worldTransform;
        var localTransform = this.localTransform;
        var entity = this.entity;
        var alpha = entity.alpha;
        var position = entity.position;
        var rotation = entity.rotation;
        var scale = entity.scale;
        var renderer = data.renderer;
        var viewport = data.viewport;
        var tx = 0;
        var ty = 0;
        var sx = scale.x;
        var sy = scale.y;

        localTransform.reset();

        // translate
        if (Transform.subPixel) {
            tx += position.x + this.x;
            ty += position.y + this.y;
        } else {
            tx += Math.round(position.x + this.x);
            ty += Math.round(position.y + this.y);
        }
        // scroll (only applies to parent objects)
        if (!entity.parent && !entity.float) {
            tx += -viewport.x;
            ty += -viewport.y;
        }

        // transform
        localTransform.scale(sx, sy);
        if (entity.rotation % twoPi) {
            // rotated?
            localTransform.rotate(rotation);
        }
        localTransform.translate(tx, ty);
        this.oldAlpha = data.renderer.getOpacity();

        // apply transform
        currentTransform = renderer.getTransform().clone();
        currentTransform.copyInto(worldTransform);
        worldTransform.multiplyWith(localTransform);

        renderer.save();
        renderer.setTransform(
            worldTransform.a,
            worldTransform.b,
            worldTransform.c,
            worldTransform.d,
            worldTransform.tx,
            worldTransform.ty
        );
        renderer.setOpacity(this.oldAlpha * alpha);
    };

    Transform.prototype.postDraw = function (data) {
        var renderer = data.renderer;

        // restore renderer
        renderer.setOpacity(this.oldAlpha);
        renderer.restore();
    };

    Transform.prototype.getWorldPosition = function () {
        return this.toWorldPosition(this.entity.position);
    };

    Transform.prototype.toWorldPosition = function (localPosition) {
        // TODO: transform point using the tranform matrices instead of looping through parents
        var positionVector,
            matrix,
            entity = this.entity,
            position,
            parent,
            parents = [],
            i,
            isFloating = false;

        // no parents: is already a world position
        if (!entity.parent) {
            if (entity.float) {
                return localPosition.add(Bento.getViewport().getCorner());
            } else {
                return localPosition.clone();
            }
        }

        // get all parents
        parent = entity;
        while (parent.parent) {
            parent = parent.parent;
            parents.push(parent);
        }
        // is top parent floating?
        if (parents.length && parents[parents.length - 1].float) {
            isFloating = true;
        }

        // make a copy
        if (entity.float || isFloating) {
            positionVector = localPosition.add(Bento.getViewport().getCorner());
        } else {
            positionVector = localPosition.clone();
        }

        /**
         * transform the position vector with each component
         */
        for (i = 0; i < parents.length; ++i) {
            parent = parents[i];

            // construct a scaling matrix and apply to position vector
            matrix = new Matrix().scale(parent.scale.x, parent.scale.y);
            matrix.multiplyWithVector(positionVector);
            // construct a rotation matrix and apply to position vector
            if (parent.rotation % twoPi) {
                matrix = new Matrix().rotate(parent.rotation);
                matrix.multiplyWithVector(positionVector);
            }
            // construct a translation matrix and apply to position vector
            matrix = new Matrix().translate(parent.position.x, parent.position.y);
            matrix.multiplyWithVector(positionVector);
        }

        return positionVector;
    };

    Transform.prototype.toLocalPosition = function (worldPosition) {
        // TODO: transform point using the tranform matrices instead of looping through parents

        // get the comparable position and reverse transform once more to get into the local space
        var positionVector = this.toComparablePosition(worldPosition);

        // construct a translation matrix and apply to position vector
        var entity = this.entity;
        var position = entity.position;
        var matrix = new Matrix().translate(-position.x, -position.y);
        matrix.multiplyWithVector(positionVector);
        // construct a rotation matrix and apply to position vector
        if (entity.rotation % twoPi) {
            matrix = new Matrix().rotate(-entity.rotation);
            matrix.multiplyWithVector(positionVector);
        }
        // construct a scaling matrix and apply to position vector
        matrix = new Matrix().scale(1 / entity.scale.x, 1 / entity.scale.y);
        matrix.multiplyWithVector(positionVector);

        return positionVector;
    };

    Transform.prototype.toComparablePosition = function (worldPosition) {
        var positionVector,
            matrix,
            entity = this.entity,
            position,
            parent,
            parents = [],
            i,
            isFloating = false;

        // no parents
        if (!entity.parent) {
            if (entity.float) {
                return worldPosition.subtract(Bento.getViewport().getCorner());
            } else {
                return worldPosition;
            }
        }

        // get all parents
        parent = entity;
        while (parent.parent) {
            parent = parent.parent;
            parents.push(parent);
        }
        // is top parent floating?
        if (parents.length && parents[parents.length - 1].float) {
            isFloating = true;
        }

        // make a copy
        if (entity.float || isFloating) {
            positionVector = worldPosition.subtract(Bento.getViewport().getCorner());
        } else {
            positionVector = worldPosition.clone();
        }

        /**
         * Reverse transform the position vector with each component
         */
        for (i = parents.length - 1; i >= 0; --i) {
            parent = parents[i];

            // construct a translation matrix and apply to position vector
            position = parent.position;
            matrix = new Matrix().translate(-position.x, -position.y);
            matrix.multiplyWithVector(positionVector);
            // construct a rotation matrix and apply to position vector
            if (parent.rotation % twoPi) {
                matrix = new Matrix().rotate(-parent.rotation);
                matrix.multiplyWithVector(positionVector);
            }
            // construct a scaling matrix and apply to position vector
            matrix = new Matrix().scale(1 / parent.scale.x, 1 / parent.scale.y);
            matrix.multiplyWithVector(positionVector);
        }

        return positionVector;
    };

    Transform.subPixel = true;

    return Transform;
});
/**
 * A collection of useful functions
 * <br>Exports: Object
 * @module bento/utils
 * @moduleName Utils
 */
bento.define('bento/utils', [], function () {
    'use strict';
    var Utils,
        dev = false,
        isString = function (value) {
            return typeof value === 'string' || value instanceof String;
        },
        isArray = Array.prototype.isArray || function (value) {
            return Object.prototype.toString.call(value) === '[object Array]';
        },
        isObject = function (value) {
            return Object.prototype.toString.call(value) === '[object Object]';
        },
        isFunction = function (value) {
            return Object.prototype.toString.call(value) === '[object Function]';
        },
        isNumber = function (obj) {
            return Object.prototype.toString.call(obj) === '[object Number]';
        },
        isBoolean = function (obj) {
            return obj === true || obj === false ||
                Object.prototype.toString.call(obj) === '[object Boolean]';
        },
        isInt = function (obj) {
            return parseFloat(obj) === parseInt(obj, 10) && !isNaN(obj);
        },
        isUndefined = function (obj) {
            return obj === void(0);
        },
        isDefined = function (obj) {
            return obj !== void(0);
        },
        isEmpty = function (obj) {
            return obj == null;
        },
        isNotEmpty = function (obj) {
            return obj != null;
        },
        isObjLiteral = function (_obj) {
            var _test = _obj;
            return (typeof _obj !== 'object' || _obj === null ?
                false :
                (
                    (function () {
                        while (!false) {
                            if (Object.getPrototypeOf(_test = Object.getPrototypeOf(_test)) === null) {
                                break;
                            }
                        }
                        return Object.getPrototypeOf(_obj) === _test;
                    })()
                )
            );
        },
        removeFromArray = function (array, obj) {
            var index = array.indexOf(obj);
            var removed = false;
            while (index >= 0) {
                array.splice(index, 1);
                index = array.indexOf(obj);
                removed = true;
            }
            return removed;
        },
        extend = function (obj1, obj2, force, onConflict) {
            var prop, temp;
            for (prop in obj2) {
                if (obj2.hasOwnProperty(prop)) {
                    if (obj1.hasOwnProperty(prop) && !force) {
                        // property already exists, move it up
                        obj1.base = obj1.base || {};
                        temp = {};
                        temp[prop] = obj1[prop];
                        extend(obj1.base, temp);
                        if (onConflict) {
                            onConflict(prop);
                        }
                    }
                    if (isObjLiteral(obj2[prop])) {
                        obj1[prop] = extend({}, obj2[prop]);
                    } else {
                        obj1[prop] = obj2[prop];
                    }
                }
            }
            return obj1;
        },
        getKeyLength = function (obj) {
            if (!obj) {
                Utils.log("WARNING: object is " + obj);
                return 0;
            }
            return Object.keys(obj).length;
        },
        copyObject = function (obj) {
            var newObject = {};
            var key;
            for (key in obj) {
                if (!obj.hasOwnProperty(key)) {
                    continue;
                }
                newObject[key] = obj[key];
                //TODO? deep copy?
            }
            return newObject;
        },
        setAnimationFrameTimeout = function (callback, timeout) {
            var now = new Date().getTime(),
                rafID = null;

            if (timeout === undefined) timeout = 1;

            function animationFrame() {
                var later = new Date().getTime();

                if (later - now >= timeout) {
                    callback();
                } else {
                    rafID = window.requestAnimationFrame(animationFrame);
                }
            }

            animationFrame();
            return {
                cancel: function () {
                    if (typeof cancelAnimationFrame !== 'undefined') {
                        window.cancelAnimationFrame(rafID);
                    }
                }
            };
        },
        stableSort = (function () {
            // https://github.com/Two-Screen/stable
            // A stable array sort, because `Array#sort()` is not guaranteed stable.
            // This is an implementation of merge sort, without recursion.
            var stable = function (arr, comp) {
                    return exec(arr.slice(), comp);
                },
                // Execute the sort using the input array and a second buffer as work space.
                // Returns one of those two, containing the final result.
                exec = function (arr, comp) {
                    if (typeof (comp) !== 'function') {
                        comp = function (a, b) {
                            return String(a).localeCompare(b);
                        };
                    }

                    // Short-circuit when there's nothing to sort.
                    var len = arr.length;
                    if (len <= 1) {
                        return arr;
                    }

                    // Rather than dividing input, simply iterate chunks of 1, 2, 4, 8, etc.
                    // Chunks are the size of the left or right hand in merge sort.
                    // Stop when the left-hand covers all of the array.
                    var buffer = new Array(len);
                    for (var chk = 1; chk < len; chk *= 2) {
                        pass(arr, comp, chk, buffer);

                        var tmp = arr;
                        arr = buffer;
                        buffer = tmp;
                    }
                    return arr;
                },
                // Run a single pass with the given chunk size.
                pass = function (arr, comp, chk, result) {
                    var len = arr.length;
                    var i = 0;
                    // Step size / double chunk size.
                    var dbl = chk * 2;
                    // Bounds of the left and right chunks.
                    var l, r, e;
                    // Iterators over the left and right chunk.
                    var li, ri;

                    // Iterate over pairs of chunks.
                    for (l = 0; l < len; l += dbl) {
                        r = l + chk;
                        e = r + chk;
                        if (r > len) r = len;
                        if (e > len) e = len;

                        // Iterate both chunks in parallel.
                        li = l;
                        ri = r;
                        while (true) {
                            // Compare the chunks.
                            if (li < r && ri < e) {
                                // This works for a regular `sort()` compatible comparator,
                                // but also for a simple comparator like: `a > b`
                                if (comp(arr[li], arr[ri]) <= 0) {
                                    result[i++] = arr[li++];
                                } else {
                                    result[i++] = arr[ri++];
                                }
                            }
                            // Nothing to compare, just flush what's left.
                            else if (li < r) {
                                result[i++] = arr[li++];
                            } else if (ri < e) {
                                result[i++] = arr[ri++];
                            }
                            // Both iterators are at the chunk ends.
                            else {
                                break;
                            }
                        }
                    }
                };
            stable.inplace = function (arr, comp) {
                var result = exec(arr, comp);

                // This simply copies back if the result isn't in the original array,
                // which happens on an odd number of passes.
                if (result !== arr) {
                    pass(result, null, arr.length, arr);
                }

                return arr;
            };
            // return it instead and keep the method local to this scope
            return stable;
        })(),
        keyboardMapping = (function () {
            var aI,
                keys = {
                    // http://github.com/RobertWhurst/KeyboardJS
                    // general
                    "3": ["cancel"],
                    "8": ["backspace"],
                    "9": ["tab"],
                    "12": ["clear"],
                    "13": ["enter"],
                    "16": ["shift"],
                    "17": ["ctrl"],
                    "18": ["alt", "menu"],
                    "19": ["pause", "break"],
                    "20": ["capslock"],
                    "27": ["escape", "esc"],
                    "32": ["space", "spacebar"],
                    "33": ["pageup"],
                    "34": ["pagedown"],
                    "35": ["end"],
                    "36": ["home"],
                    "37": ["left"],
                    "38": ["up"],
                    "39": ["right"],
                    "40": ["down"],
                    "41": ["select"],
                    "42": ["printscreen"],
                    "43": ["execute"],
                    "44": ["snapshot"],
                    "45": ["insert", "ins"],
                    "46": ["delete", "del"],
                    "47": ["help"],
                    "91": ["command", "windows", "win", "super", "leftcommand", "leftwindows", "leftwin", "leftsuper"],
                    "92": ["command", "windows", "win", "super", "rightcommand", "rightwindows", "rightwin", "rightsuper"],
                    "145": ["scrolllock", "scroll"],
                    "186": ["semicolon", ";"],
                    "187": ["equal", "equalsign", "="],
                    "188": ["comma", ","],
                    "189": ["dash", "-"],
                    "190": ["period", "."],
                    "191": ["slash", "forwardslash", "/"],
                    "192": ["graveaccent", "`"],

                    "195": ["GamepadA"],
                    "196": ["GamepadB"],
                    "197": ["GamepadX"],
                    "198": ["GamepadY"],
                    "199": ["GamepadRightShoulder"], // R1
                    "200": ["GamepadLeftShoulder"], // L1
                    "201": ["GamepadLeftTrigger"], // L2
                    "202": ["GamepadRightTrigger"], // R2
                    "203": ["GamepadDPadUp"],
                    "204": ["GamepadDPadDown"],
                    "205": ["GamepadDPadLeft"],
                    "206": ["GamepadDPadRight"],
                    "207": ["GamepadMenu"], // 'start' button
                    "208": ["GamepadView"], // 'select' button
                    "209": ["GamepadLeftThumbstick"], // pressed left thumbstick
                    "210": ["GamepadRightThumbstick"], // pressed right thumbstick
                    "211": ["GamepadLeftThumbstickUp"],
                    "212": ["GamepadLeftThumbstickDown"],
                    "213": ["GamepadLeftThumbstickRight"],
                    "214": ["GamepadLeftThumbstickLeft"],
                    "215": ["GamepadRightThumbstickUp"],
                    "216": ["GamepadRightThumbstickDown"],
                    "217": ["GamepadRightThumbstickRight"],
                    "218": ["GamepadRightThumbstickLeft"],
                    "7": ["GamepadXboxButton"], // the middle xbox button

                    "219": ["openbracket", "["],
                    "220": ["backslash", "\\"],
                    "221": ["closebracket", "]"],
                    "222": ["apostrophe", "'"],

                    //0-9
                    "48": ["zero", "0"],
                    "49": ["one", "1"],
                    "50": ["two", "2"],
                    "51": ["three", "3"],
                    "52": ["four", "4"],
                    "53": ["five", "5"],
                    "54": ["six", "6"],
                    "55": ["seven", "7"],
                    "56": ["eight", "8"],
                    "57": ["nine", "9"],

                    //numpad
                    "96": ["numzero", "num0"],
                    "97": ["numone", "num1"],
                    "98": ["numtwo", "num2"],
                    "99": ["numthree", "num3"],
                    "100": ["numfour", "num4"],
                    "101": ["numfive", "num5"],
                    "102": ["numsix", "num6"],
                    "103": ["numseven", "num7"],
                    "104": ["numeight", "num8"],
                    "105": ["numnine", "num9"],
                    "106": ["nummultiply", "num*"],
                    "107": ["numadd", "num+"],
                    "108": ["numenter"],
                    "109": ["numsubtract", "num-"],
                    "110": ["numdecimal", "num."],
                    "111": ["numdivide", "num/"],
                    "144": ["numlock", "num"],

                    //function keys
                    "112": ["f1"],
                    "113": ["f2"],
                    "114": ["f3"],
                    "115": ["f4"],
                    "116": ["f5"],
                    "117": ["f6"],
                    "118": ["f7"],
                    "119": ["f8"],
                    "120": ["f9"],
                    "121": ["f10"],
                    "122": ["f11"],
                    "123": ["f12"],

                    // volume keys Microsoft Surface
                    "174": ["volDown"],
                    "175": ["volUp"]
                };
            for (aI = 65; aI <= 90; aI += 1) {
                keys[aI] = keys[aI] || [];
                keys[aI].push(String.fromCharCode(aI + 32));
            }

            return keys;
        })(),
        remoteMapping = (function () {
            // the commented out keys are not used by the remote's micro gamepad
            var buttons = {
                "0": ["A", "a", "click"], // click on touch area
                // "1": ["B"],
                "2": ["X", "x", "play", "pause"], // pause/play button
                // "3": ["Y"],
                // "4": ["L1"],
                // "5": ["R1"],
                // "6": ["L2"],
                // "7": ["R2"],
                "12": ["up"], // upper half touch area
                "13": ["down"], // lower half touch area
                "14": ["left"], // left half touch area
                "15": ["right"], // right half touch area
                "16": ["menu"] // menu button
            };

            return buttons;
        })(),
        /**
         * Mapping for the Xbox controller
         * @return {Object} mapping of all the buttons
         */
        gamepadMapping = (function () {
            var buttons = {
                "0": ["A", "a"],
                "1": ["B", "b"],
                "2": ["X", "x"],
                "3": ["Y", "y"],
                "4": ["L1", "l1"],
                "5": ["R1", "r1"],
                "6": ["L2", "l2"],
                "7": ["R2", "r2"],
                "8": ["back", "select"],
                "9": ["start"],
                "10": ["right-thumb", "right-stick"],
                "11": ["left-thumb", "left-stick"],
                "12": ["up"],
                "13": ["down"],
                "14": ["left"],
                "15": ["right"],
                "16": ["menu", "home"]
            };

            return buttons;
        })();

    Utils = {
        /**
         * Checks if environment is iOS (using Cocoon.io)
         * @function
         * @instance
         * @name isNativeIos
         * @snippet Utils.isNativeIos|Boolean
        Utils.isNativeIos()
         */
        isNativeIos: function () {
            if (navigator.isCocoonJS && window.Cocoon && window.Cocoon.getPlatform() === 'ios') {
                return true;
            } else if (window.device) {
                if (window.device && window.device.platform) {
                    return window.device.platform.toLowerCase() === 'ios';
                }
            }
            return false;
        },
        /**
         * Checks if environment is Android (using Cocoon.io)
         * @function
         * @instance
         * @name isNativeAndroid
         * @snippet Utils.isNativeAndroid|Boolean
        Utils.isNativeAndroid()
         */
        isNativeAndroid: function () {
            var platform;
            if (navigator.isCocoonJS && window.Cocoon) {
                platform = window.Cocoon.getPlatform();
                if (platform === 'android' || platform === 'amazon') {
                    return true;
                }
            }  else if (window.device) {
                if (window.device && window.device.platform) {
                    return window.device.platform.toLowerCase() === 'android';
                }
            }
            return false;
        },
        /**
         * Callback during foreach
         *
         * @callback IteratorCallback
         * @param {Object} value - The value in the array or object literal
         * @param {Number} index - Index of the array or key in object literal
         * @param {Number} length - Length of the array or key count in object literal
         * @param {Function} breakLoop - Calling this breaks the loop and stops iterating over the array or object literal
         */
        /**
         * Loops through an array
         * @function
         * @instance
         * @param {Array/Object} array - Array or Object literal to loop through
         * @param {IteratorCallback} callback - Callback function
         * @name forEach
         * @snippet Utils.forEach|snippet
Utils.forEach(${1:array}, function (${2:item}, i, l, breakLoop) {
    ${3:// code here}
});
         */
        forEach: function (array, callback) {
            var obj;
            var i;
            var l;
            var stop = false;
            var breakLoop = function () {
                stop = true;
            };
            if (Utils.isArray(array)) {
                for (i = 0, l = array.length; i < l; ++i) {
                    callback(array[i], i, l, breakLoop, array[i + 1]);
                    if (stop) {
                        return;
                    }
                }
            } else {
                l = Utils.getKeyLength(array);
                for (i in array) {
                    if (!array.hasOwnProperty(i)) {
                        continue;
                    }
                    callback(array[i], i, l, breakLoop);
                    if (stop) {
                        return;
                    }
                }
            }
        },
        /**
         * Returns either the provided value, or the provided fallback value in case the provided value was undefined
         * @function
         * @instance
         * @name getDefault
         * @snippet Utils.getDefault|snippet
        Utils.getDefault(${1:value}, ${2:default})
         * @param {Anything} value - any type
         * @param {Anything} value - any type
         */
        getDefault: function (param, fallback) {
            return (param !== void(0)) ? param : fallback;
        },
        /**
         * Returns a random integer [0...n)
         * @function
         * @instance
         * @name getRandom
         * @snippet Utils.getRandom|Number
        Utils.getRandom(${1:Number})
         * @param {Number} n - limit of random number
         * @return {Number} Randomized integer
         */
        getRandom: function (n) {
            return Math.floor(Math.random() * n);
        },
        /**
         * Returns a random integer between range [min...max)
         * @function
         * @instance
         * @name getRandomRange
         * @snippet Utils.getRandomRange|Number
        Utils.getRandomRange(${1:Minimum}, ${2:Number})
         * @param {Number} min - minimum value
         * @param {Number} max - maximum value
         * @return {Number} Randomized integer
         */
        getRandomRange: function (min, max) {
            var diff = max - min;
            return min + Math.floor(Math.random() * diff);
        },
        /**
         * Returns a random float [0...n)
         * @function
         * @instance
         * @name getRandomFloat
         * @snippet Utils.getRandomFloat|Number
        Utils.getRandomFloat(${1:Number})
         * @param {Number} n - limit of random number
         * @return {Number} Randomized number
         */
        getRandomFloat: function (n) {
            return Math.random() * n;
        },
        /**
         * Returns a random float between range [min...max)
         * @function
         * @instance
         * @name getRandomRangeFloat
         * @snippet Utils.getRandomRangeFloat|Number
        Utils.getRandomRangeFloat(${1:Minimum}, ${2:Number})
         * @param {Number} min - minimum value
         * @param {Number} max - maximum value
         * @return {Number} Randomized number
         */
        getRandomRangeFloat: function (min, max) {
            var diff = max - min;
            return min + Math.random() * diff;
        },
        /**
         * Get the inner size of the screen (MRAID compatible).
         * In case of the browsers, the screensize is the innerwidth and innerheight
         * @function
         * @instance
         * @returns Object
         * @name getScreenSize
         * @snippet Utils.getScreenSize|Object
        Utils.getScreenSize()
         */
        getScreenSize: function () {
            var screenSize = {
                width: 0,
                height: 0
            };
            if (window.mraid) {
                screenSize.width = window.mraid.getMaxSize().width;
                screenSize.height = window.mraid.getMaxSize().height;
            } else {
                screenSize.width = window.innerWidth;
                screenSize.height = window.innerHeight;
            }
            return screenSize;
        },
        /**
         * Turns degrees into radians
         * @function
         * @instance
         * @name toRadian
         * @snippet Utils.toRadian|Number
        Utils.toRadian(${1:Degrees})
         * @param {Number} degree - value in degrees
         * @return {Number} radians
         */
        toRadian: function (degree) {
            return degree * Math.PI / 180;
        },
        /**
         * Turns radians into degrees
         * @function
         * @instance
         * @name toDegree
         * @snippet Utils.toDegree|Number
        Utils.toDegree(${1:Radians})
         * @param {Number} radians - value in radians
         * @return {Number} degree
         */
        toDegree: function (radian) {
            return radian / Math.PI * 180;
        },
        /**
         * Sign of a number. Returns 0 if value is 0.
         * @function
         * @instance
         * @param {Number} value - value to check
         * @name sign
         * @snippet Utils.sign|Number
        Utils.sign(${1:Number})
         */
        sign: function (value) {
            if (value > 0) {
                return 1;
            } else if (value < 0) {
                return -1;
            } else {
                return 0;
            }
        },
        /**
         * Steps towards a number without going over the limit
         * @function
         * @instance
         * @param {Number} start - current value
         * @param {Number} end - target value
         * @param {Number} step - step to take (should always be a positive value)
         * @name approach
         * @snippet Utils.approach|Number
        Utils.approach(${1:start}, ${2:end}, ${3:step})
         */
        approach: function (start, end, max) {
            max = Math.abs(max);
            if (start < end) {
                return Math.min(start + max, end);
            } else {
                return Math.max(start - max, end);
            }
        },
        /**
         * Repeats a function for a number of times
         * @function
         * @instance
         * @param {Number} number - Number of times to repeat
         * @param {Function} fn - function to perform
         * @param {Array} [params] - Parameters to pass to function
         * @name repeat
         * @snippet Utils.repeat|snippet
        Utils.repeat(${1:1}, ${2:function (i, l) {\}})
         */
        repeat: function (number, fn) {
            var i;
            var count;
            var action;
            if (typeof number === "number") {
                count = number;
                action = fn;
            } else {
                // swapped the parameters
                count = fn;
                action = number;
            }
            if (!action.apply) {
                Utils.log("Did not pass a function");
                return;
            }
            for (i = 0; i < count; ++i) {
                action(i, count);
            }
        },
        /**
         * A simple hashing function, similar to Java's String.hashCode()
         * source: http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
         * @function
         * @instance
         * @param {String} string - String to hash
         * @name checksum
         * @snippet Utils.checksum|Number
        Utils.checksum(${1:String})
         */
        checksum: function (str) {
            var hash = 0,
                strlen = (str || '').length,
                i,
                c;
            if (strlen === 0) {
                return hash;
            }
            for (i = 0; i < strlen; ++i) {
                c = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + c;
                hash = hash & hash; // Convert to 32bit integer
            }
            return hash;
        },
        /**
         * Extends object literal properties with another object
         * If the objects have the same property name, then the old one is pushed to a property called "base"
         * @function
         * @instance
         * @name extend
         * @snippet Utils.extend|Object
        Utils.extend(${1:baseObject}, ${2:extendedObject})
         * @snippet Utils.extend|conflict
Utils.extend(${1:baseObject}, ${2:extendedObject}, false, function (prop) {
    ${4://code here}
});
         * @param {Object} object1 - original object
         * @param {Object} object2 - new object
         * @param {Bool} [force] - Overwrites properties (defaults to false)
         * @param {Function} [onConflict] - Called when properties have the same name. Only called if force is false.
         * @return {Array} The updated array
         */
        extend: extend,
        /**
         * Counts the number of keys in an object literal
         * @function
         * @instance
         * @name getKeyLength
         * @snippet Utils.getKeyLength|Number
        Utils.getKeyLength(${1:object})
         * @param {Object} object - object literal
         * @return {Number} Number of keys
         */
        getKeyLength: getKeyLength,
        /**
         * Returns a (shallow) copy of an object literal
         * @function
         * @instance
         * @name copyObject
         * @snippet Utils.copyObject|Object
        Utils.copyObject(${1:Object})
         * @param {Object} object - object literal
         * @return {Object} Shallow copy
         */
        copyObject: copyObject,
        /**
         * Returns a clone of a JSON object
         * @function
         * @instance
         * @param {Object} jsonObj - Object literal that adheres to JSON standards
         * @name cloneJson
         * @snippet Utils.cloneJson|Object
        Utils.cloneJson(${1:json})
         */
        cloneJson: function (jsonObj) {
            var out;
            try {
                out = JSON.parse(JSON.stringify(jsonObj));
            } catch (e) {
                out = {};
                console.log('WARNING: object cloning failed');
            }
            return out;
        },
        /**
         * Removes entry from array (note: only removes all matching values it finds)
         * @function
         * @instance
         * @param {Array} array - array
         * @param {Anything} value - any type
         * @return {Bool} True if removal was successful, false if the value was not found
         * @name removeFromArray
         * @snippet Utils.removeFromArray|Object
        Utils.removeFromArray(${1:Array}, ${2:Value})
         */
        removeFromArray: removeFromArray,
        /**
         * Checks whether a value is between two other values
         * @function
         * @instance
         * @param {Number} min - lower limit
         * @param {Number} value - value to check that's between min and max
         * @param {Number} max - upper limit
         * @param {Boolean} includeEdge - includes edge values
         * @name isBetween
         * @snippet Utils.isBetween|Boolean
        Utils.isBetween(${1:minimum}, ${2:value}, ${3:maximum}, ${4:false})
         */
        isBetween: function (min, value, max, includeEdge) {
            if (includeEdge) {
                return min <= value && value <= max;
            }
            return min < value && value < max;
        },
        /**
         * Picks one of the parameters of this function and returns it
         * @function
         * @instance
         * @name pickRandom
         * @snippet Utils.pickRandom|Object
        Utils.pickRandom(${1:item1}, ${2:item2}, ${3:...})
         */
        pickRandom: function () {
            return arguments[this.getRandom(arguments.length)];
        },
        //http://javascript.about.com/od/problemsolving/a/modulobug.htm
        /**
         * Modulo that will return in a positive remainder
         * @function
         * @instance
         * @name modulo
         * @snippet Utils.modulo|Number
        Utils.modulo(${1:var1}, ${2:var2})
         */
        modulo: function (b, n) {
            return ((b % n) + n) % n;
        },
        /**
         * Picks one of the items in an Array
         * @function
         * @instance
         * @name pickRandomFrom
         * @param {Array} array
         * @snippet Utils.pickRandomFrom|snippet
        Utils.pickRandomFrom(${1:array})
         */
        pickRandomFrom: function (array) {
            return array[this.getRandom(array.length)];
        },
        /**
         * Clamps a numerical value between a minimum and maximum value
         * @function
         * @instance
         * @param {Number} min - lower limit
         * @param {Number} value - value to clamp between min and max
         * @param {Number} max - upper limit
         * @name clamp
         * @snippet Utils.clamp
        Utils.clamp(${1:min}, ${2:value}, ${3:max})
         */
        clamp: function (min, value, max) {
            return Math.max(min, Math.min(value, max));
        },
        /**
         * Checks useragent if device is an apple device. Works on web only.
         * @function
         * @instance
         * @name isApple
         * @snippet Utils.isApple|Boolean
        Utils.isApple()
         */
        isApple: function () {
            var device = (navigator.userAgent).match(/iPhone|iPad|iPod/i);
            return /iPhone/i.test(device) || /iPad/i.test(device) || /iPod/i.test(device);
        },
        /**
         * Checks useragent if device is an android device. Works on web only.
         * @function
         * @instance
         * @name isAndroid
         * @snippet Utils.isAndroid|Boolean
        Utils.isAndroid()
         */
        isAndroid: function () {
            return /Android/i.test(navigator.userAgent);
        },
        /**
         * Checks if environment is cocoon
         * @function
         * @instance
         * @name isCocoonJs
         * @snippet Utils.isCocoonJs|Boolean
        Utils.isCocoonJs()
         */
        isCocoonJS: function () {
            return navigator.isCocoonJS;
        },
        isCocoonJs: function () {
            return navigator.isCocoonJS;
        },
        /**
         * Checks if environment is mobile browser
         * @function
         * @instance
         * @name isMobileBrowser
         * @snippet Utils.isMobileBrowser|Boolean
        Utils.isMobileBrowser()
         */
        isMobileBrowser: function () {
            var check = false;
            (function (a) {
                if (/(android|bb\d+|meego|android|ipad|playbook|silk).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(a) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0, 4))) {
                    check = true;
                }
            })(navigator.userAgent || navigator.vendor || window.opera);
            return check;
        },
        /**
         * Checks if environment is Android (using Cordova Device plugin)
         * @function
         * @instance
         * @name isAndroidDevice
         * @snippet Utils.isAndroidDevice|Boolean
        Utils.isAndroidDevice()
         */
        isAndroidDevice: function () {
            var platform = window.device && window.device.platform ? window.device.platform.toLowerCase() : '';
            if (platform === 'android') {
                return true;
            }
            return false;
        },
        /**
         * Checks if environment is iOS (using Cordova Device plugin)
         * @function
         * @instance
         * @name isIosDevice
         * @snippet Utils.isIosDevice|Boolean
        Utils.isIosDevice()
         */
        isIosDevice: function () {
            var platform = window.device && window.device.platform ? window.device.platform.toLowerCase() : '';
            if (platform === 'ios') {
                return true;
            }
            return false;
        },
        /**
         * Checks if environment is Amazon/Fire OS (using Cordova Device plugin)
         * @function
         * @instance
         * @name isAmazonDevice
         * @snippet Utils.isAmazonDevice|Boolean
        Utils.isAmazonDevice()
         */
        isAmazonDevice: function () {
            var platform = window.device && window.device.platform ? window.device.platform.toLowerCase() : '';
            // platform can be either 'amazon-fireos' or 'Amazon'
            if (platform.indexOf('amazon') > -1) {
                return true;
            }
            return false;
        },
        /**
         * Turn dev mode on or off to use throws or console.logs
         * @function
         * @instance
         * @param {Boolean} bool - set to true to use throws instead of console.logs
         * @name setDev
         * @snippet Utils.setDev|snippet
        Utils.setDev()
         */
        setDev: function (bool) {
            dev = bool;
        },
        /**
         * Is dev mode on
         * @function
         * @instance
         * @name isDev
         * @snippet Utils.isDev|Boolean
        Utils.isDev()
         */
        isDev: function () {
            return dev;
        },
        /**
         * Wrapper around console.error
         * @function
         * @instance
         * @param {String} msg - the message to log
         * @name log
         * @snippet Utils.log
        Utils.log('WARNING: ${1}')
         */
        log: function (msg) {
            console.error(msg);
        },
        /**
         * @function
         * @instance
         * @name isString
         * @snippet Utils.isString|Boolean
        Utils.isString(${1:String})
         */
        isString: isString,
        /**
         * @function
         * @instance
         * @name isArray
         * @snippet Utils.isArray|Boolean
        Utils.isArray(${1:Array})
         */
        isArray: isArray,
        /**
         * @function
         * @instance
         * @name isObject
         * @snippet Utils.isObject|Boolean
        Utils.isObject(${1:Object})
         */
        isObject: isObject,
        /**
         * @function
         * @instance
         * @name isFunction
         * @snippet Utils.isFunction|Boolean
        Utils.isFunction(${1:Function})
         */
        isFunction: isFunction,
        /**
         * @function
         * @instance
         * @name isNumber
         * @snippet Utils.isNumber|Boolean
        Utils.isNumber(${1:Number})
         */
        isNumber: isNumber,
        /**
         * @function
         * @instance
         * @name isBoolean
         * @snippet Utils.isBoolean|Boolean
        Utils.isBoolean(${1:Boolean})
         */
        isBoolean: isBoolean,
        /**
         * @function
         * @instance
         * @name isInt
         * @snippet Utils.isInt|Boolean
        Utils.isInt(${1:Integer})
         */
        isInt: isInt,
        /**
         * Is parameter undefined?
         * @function
         * @name isUndefined
         * @snippet Utils.isUndefined|Boolean
        Utils.isUndefined(${1})
         * @param {Anything} obj - any type
         * @return {Bool} True if parameter is undefined
         * @instance
         */
        isUndefined: isUndefined,
        /**
         * Is parameter anything other than undefined?
         * @function
         * @instance
         * @param {Anything} obj - any type
         * @return {Bool} True if parameter is not undefined
         * @name isDefined
         * @snippet Utils.isDefined|Boolean
        Utils.isDefined(${1})
         */
        isDefined: isDefined,
        /**
         * Is parameter null or undefined
         * @function
         * @instance
         * @param {Anything} obj - any type
         * @return {Bool} True if parameter is null or undefined
         * @name isEmpty
         * @snippet Utils.isEmpty|Boolean
        Utils.isEmpty(${1})
         */
        isEmpty: isEmpty,
        /**
         * Is parameter anything other than null or undefined
         * @function
         * @instance
         * @param {Anything} obj - any type
         * @return {Bool} True if parameter is not null or undefined
         * @name isNotEmpty
         * @snippet Utils.isNotEmpty|Boolean
        Utils.isNotEmpty(${1})
         */
        isNotEmpty: isNotEmpty,
        stableSort: stableSort,
        keyboardMapping: keyboardMapping,
        remoteMapping: remoteMapping,
        gamepadMapping: gamepadMapping,
        /**
         * Enum for sort mode, pass this to Bento.setup
         * @readonly
         * @enum {Number}
         */
        SortMode: {
            ALWAYS: 0,
            NEVER: 1,
            SORT_ON_ADD: 2
        }
    };
    return Utils;
});