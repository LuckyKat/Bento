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