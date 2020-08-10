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
    'lzstring',
    'threeloadingmanager'
], function (
    EventSystem,
    PackedImage,
    Utils,
    Audia,
    LZString,
    ThreeLoadingManager
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
            spine3d: {},
            meshes: {},

            // packed
            'packed-images': {},
            'packed-spritesheets': {},
            'packed-json': {}
        };
        var spineAssetLoader;
        var tempSpineImage;
        var currentlyLoadingGroup; // to help ThreeLoadingManager find the path to a buffer or texture when loading resources from Base64
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
                    audio.src = src + (useQueries && src.indexOf('data:') < 0 ? '?t=' + now : '');
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
                // pixi / three
                if (img.texture) {
                    if (img.texture.destroy) {
                        img.texture.destroy();
                    }
                    if (img.texture.dispose) {
                        img.texture.dispose();
                    }
                }
            };

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

            img.src = source + (useQueries && source.indexOf('data:') < 0 ? '?t=' + now : '');
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
        var loadSpine3d = function (name, source, callback) {
            var spine3d = {
                images: {},
                imageCount: 0,
                json: null,
                jsonRaw: null,
                atlas: null,
            };
            var loading = 0;

            var checkForCompletion = function () {
                if (spine3d.imageCount >= loading && spine3d.json !== null && spine3d.atlas !== null) {
                    callback(null, name, spine3d);
                }
            };
            var loadAtlas = function (name, source, callback) {
                // source is a base64 string -> parse immediately instead of doing the xhr request
                if (source.indexOf('data:application/octet-stream;base64,') === 0) {
                    var decoded;
                    if (window.decodeB64) {
                        decoded = window.decodeB64(source.replace('data:application/octet-stream;base64,', ''));
                    } else {
                        decoded = window.atob(source.replace('data:application/octet-stream;base64,', ''));
                    }
                    callback(null, name, decoded);
                    return;
                }

                var xhr = new window.XMLHttpRequest();
                if (xhr.overrideMimeType) {
                    xhr.overrideMimeType("text/html");
                }
                xhr.open('GET', source + (useQueries ? '?t=' + now : ''), true);
                xhr.onerror = function () {
                    callback('Error: loading Spine Atlas ' + source);
                };
                xhr.ontimeout = function () {
                    callback('Timeout: loading Spine Atlas ' + source);
                };
                xhr.onreadystatechange = function () {
                    var response;
                    if (xhr.readyState === 4) {
                        if ((xhr.status === 304) || (xhr.status === 200) || ((xhr.status === 0) && xhr.responseText)) {
                            response = xhr.responseText;
                            callback(null, name, response);
                        } else {
                            callback('Error: State ' + xhr.readyState + ' ' + source);
                        }
                    }
                };
                xhr.send(null);
            };
            
            var readAtlas = function (atlas) {
                var atlasLines = atlas.split(/\r\n|\r|\n/);
                var imagePaths = [];
                atlasLines.forEach(function(line) {
                    if(line.includes('.png')) {
                        imagePaths.push(line);
                    }
                });
                loading = imagePaths.length;
                imagePaths.forEach(function(sourcePng) {
                    var url;
                    if (isBase64) {
                        if (source.images[sourcePng]) {
                            // load the included base64 string instead
                            url = source.images[sourcePng];
                        } else {
                            throw 'Could not find png ' + sourcePng; 
                        }
                    } else {
                        var sourcePath = (function () {
                            // remove the final part
                            var paths = source.split('/');
                            paths.splice(-1, 1);
                            return paths.join('/') + '/';
                        })();
                        url = sourcePath + sourcePng;
                    }
                    loadImage(sourcePng, url, function (err, name, img) {
                        if (err) {
                            callback(err, name, null);
                            return;
                        }
                        spine3d.images[name] = PackedImage(img);
                        spine3d.imageCount++;
                        checkForCompletion();
                    });
                });
            };

            var sourceJson;
            var sourceAtlas;

            var isBase64 = false;

            // source can be an object with 2 base64 strings
            if (source.json) {
                sourceJson = source.json;
                sourceAtlas = source.atlas;
                isBase64 = true;

            } else {
                // sourcePng = source + '.png';
                sourceJson = source + '.json';
                sourceAtlas = source + '.atlas';
            }

            loadJSON(name, sourceJson, function (err, name, json) {
                if (err) {
                    callback(err, name, null);
                    return;
                }
                spine3d.json = json;
                spine3d.jsonRaw = JSON.stringify(json);
                checkForCompletion();
            });

            loadAtlas(name, sourceAtlas, function (err, name, atlas) {
                if (err) {
                    callback(err, name, null);
                    return;
                }
                spine3d.atlas = atlas;
                readAtlas(atlas);
                checkForCompletion();
            });
        };
        var loadFBX = function (name, source, callback) {
            if (Utils.isUndefined(THREE)) {
                callback('loadFBX: THREE namespace not defined');
                return;
            }
            if (Utils.isUndefined(THREE.FBXLoader)) {
                callback('loadFBX: THREE.FBXLoader not defined');
                return;
            }

            var assetPath = name.split('/');
            assetPath.pop();
            assetPath = assetPath.join('/');
            if (assetPath !== '') assetPath += '/';

            var manager = new ThreeLoadingManager(currentlyLoadingGroup, 'fbx', assetPath);
            var fbxLoader = new THREE.FBXLoader(manager);
            fbxLoader.load(source, function (fbx) {
                var i, mesh;
                for (i in fbx.children) {
                    mesh = fbx.children[i];
                    if (
                        mesh &&
                        mesh.material &&
                        mesh.material.emissiveIntensity &&
                        !mesh.material.emissiveMap
                    ) {
                        mesh.material.emissiveMap = mesh.material.map;
                    }
                }
                callback(null, name, fbx);
            }, undefined, function (error) {
                callback('loadFBX: ' + error);
            });
        };
        var loadGLTF = function (name, source, callback) {
            if (Utils.isUndefined(THREE)) {
                callback('loadGLTF: THREE namespace not defined');
                return;
            }
            if (Utils.isUndefined(THREE.GLTFLoader)) {
                callback('loadGLTF: THREE.GLTFLoader not defined');
                return;
            }

            var assetPath = name.split('/');
            assetPath.pop();
            assetPath = assetPath.join('/');
            if (assetPath !== '') assetPath += '/';

            var manager = new ThreeLoadingManager(currentlyLoadingGroup, 'gltf', assetPath);
            var gltfLoader = new THREE.GLTFLoader(manager);

            gltfLoader.load(source, function (gltf) {
                gltf.scene.traverse(function (child) {
                    if (
                        child.isMesh &&
                        child.material &&
                        child.material.emissiveIntensity &&
                        !child.material.emissiveMap
                    ) {
                        child.material.emissiveMap = child.material.map;
                    }
                });

                gltf.scene.animations = gltf.animations;
                callback(null, name, gltf.scene);
            }, undefined, function (error) {
                callback('loadGLTF: ' + error);
            });
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
            currentlyLoadingGroup = group;
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
            var makeLoadCallback = function (assetTable, assetKind) {
                return function (err, name, object) {
                    if (err) {
                        Utils.log(err);
                        return;
                    }
                    assetTable[name] = object;
                    assetsLoaded += 1;
                    if (Utils.isDefined(onLoaded)) {
                        onLoaded(assetsLoaded, assetCount, name, assetKind);
                    }
                    checkLoaded();
                    return true;
                };
            };

            var onLoadImage = makeLoadCallback(assets.images, 'image');
            var onLoadJson = makeLoadCallback(assets.json, 'json');
            var onLoadTTF = makeLoadCallback(assets.fonts, 'ttf');
            var onLoadAudio = makeLoadCallback(assets.audio, 'audio');
            var onLoadSpriteSheet = makeLoadCallback(assets.spritesheets, 'spriteSheet');
            var onLoadSpine = makeLoadCallback(assets.spine, 'spine');
            var onLoadSpine3d = makeLoadCallback(assets.spine3d, 'spine3d');
            var onLoadFBX = makeLoadCallback(assets.meshes, 'fbx');
            var onLoadGLTF = makeLoadCallback(assets.meshes, 'gltf');

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

            // packs
            var makeLoadPackCallback = function (packKey, assetKind) {
                return function (err, name, pack) {
                    if (err) {
                        Utils.log(err);
                        return;
                    }
                    assets[packKey][name] = pack;
                    toUnpack[packKey][name] = pack;
                    assetsLoaded += 1;
                    if (Utils.isDefined(onLoaded)) {
                        onLoaded(assetsLoaded, assetCount, name, assetKind);
                    }
                    checkLoaded();
                };
            };
            var onLoadImagePack = makeLoadPackCallback('packed-images', 'imagePack');
            var onLoadJsonPack = makeLoadPackCallback('packed-json', 'jsonPack');
            var onLoadSpriteSheetPack = makeLoadPackCallback('packed-spritesheets', 'spriteSheetPack');

            var readyForLoading = function (fn, asset, path, callback) {
                toLoad.push({
                    fn: fn,
                    asset: asset,
                    path: path,
                    callback: callback
                });
            };
            var loadAllAssets = function () {
                var i, l;
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
            // get spine3d
            if (Utils.isDefined(group.spine3d)) {
                assetCount += Utils.getKeyLength(group.spine3d);
                for (asset in group.spine3d) {
                    if (!group.spine3d.hasOwnProperty(asset)) {
                        continue;
                    }
                    readyForLoading(loadSpine3d, asset, path === 'base64' ? group.spine3d[asset] : path + 'spine3d/' + group.spine3d[asset], onLoadSpine3d);
                }
            }
            // get fbx
            if (Utils.isDefined(group.fbx)) {
                assetCount += Utils.getKeyLength(group.fbx);
                Utils.forEach(group.fbx, function (asset, assetName, l, breakLoop) {
                    // only add meshes
                    if (asset.indexOf('.fbx') > -1 || asset.indexOf('data:application/octet-stream') === 0) {
                        readyForLoading(loadFBX, assetName, group.path === 'base64' ? asset : (group.path + 'fbx/' + asset), onLoadFBX);
                    } else {
                        // other files will be handled by FBXLoader
                        assetCount--;
                    }
                });
            }
            // get gltf
            if (Utils.isDefined(group.gltf)) {
                assetCount += Utils.getKeyLength(group.gltf);
                Utils.forEach(group.gltf, function (asset, assetName, l, breakLoop) {
                    // only add gltf files
                    if (assetName.indexOf('.gltf') > -1) {
                        readyForLoading(loadGLTF, assetName, group.path === 'base64' ? asset : group.path + 'gltf/' + assetName, onLoadGLTF);
                    } else {
                        // bin and png are ignored for now (loaded by GLTFLoader)
                        assetCount--;
                    }
                });
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
            
            currentlyLoadingGroup = null;

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
         * @param {Boolean} dispose - Should dispose of resources (defaults to true)
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

                var assetTypeGroup = assets[type];

                if (type === 'gltf' || type === 'fbx') {
                    // workaround for inconsistency in mesh directory names
                    assetTypeGroup = assets['meshes'];
                }
                if (!assetTypeGroup) {
                    // skip asset type for this group, because it's empty.
                    return;
                }

                // Three.js textures, materials and geometry may be shared by multiple meshes.
                // This dictionary ensures that each resource will be freed exactly once.
                var disposeByUuid = {};

                Utils.forEach(group, function (assetPath, name) {
                    // NOTE: from this point on there are a lot of manual checks etc.
                    // would be nicer to make unify the logic...

                    // find the corresponding asset from the assets object
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
                    var removeMesh = function (mesh) {
                        mesh.traverse(function (object) {
                            if (object.isMesh) {
                                var geometry = object.geometry;
                                var material = object.material;
                                if (geometry) {
                                    disposeByUuid[geometry.uuid] = geometry;
                                }
                                if (material) {
                                    disposeByUuid[material.uuid] = material;
                                    Utils.forEach(material, function (tex) {
                                        if (tex && tex.isTexture) {
                                            disposeByUuid[tex.uuid] = tex;
                                        }
                                    });
                                }
                            }
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
                        } else if (type === 'gltf' || type === 'fbx') {
                            removeMesh(asset);
                        }

                        // Dispose if possible
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

                // Dispose all Three.js resources used by meshes in the group
                Utils.forEach(disposeByUuid, function (resource, uuid) {
                    resource.dispose();
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
         * Returns the assets need to load a Spine object
         * @function
         * @instance
         * @param {String} name - Name of Spine object
         * @returns {Object} Spine object
         * @name getSpine3D
         */
        var getSpine3D = function (name) {
            var asset = assets.spine3d[name];
            if (!Utils.isDefined(asset)) {
                Utils.log("ERROR: Spine assets " + name + " could not be found");
            }
            return asset;
        };

        /**
         * Returns a previously loaded THREE.js mesh.
         * Note, this gives the original instance. If you want a copy, use `THREE.SkeletonUtils.clone` or a wrapper function like `Onigiri.getMesh()`.
         * @function
         * @instance
         * @param {String} name - Name of mesh
         * @returns {Object} Mesh
         * @name getMesh
         */
        var getMesh = function (name) {
            var asset = assets.meshes[name];
            if (!Utils.isDefined(asset)) {
                Utils.log("ERROR: Mesh " + name + " could not be found");
            }
            return asset;
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
            getSpine3D: getSpine3D,
            getSpineLoader: getSpineLoader,
            getMesh: getMesh,
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