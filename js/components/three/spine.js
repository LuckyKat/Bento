/**
 * Spine component for three.js, requires the spine-threejs runtime (https://github.com/EsotericSoftware/spine-runtimes)
 * <br>Exports: Constructor
 * @module bento/components/three/spine
 * @moduleName Spine
 * @snippet Spine|Constructor
Spine({
    spine: '${1}',
    skin: '${2:default}',
    animation: '${3:default}',
    spineScale: ${4:1},
})

 * @param {Object} settings - Settings
 * @param {String} settings.spine - Name of the spine asset
 * @param {String} settings.skin - Name of the skin, defaults to 'default'
 * @param {String} settings.animation - Initial animation to play, defaults to 'default'
 * @param {Function} settings.onEvent - Animation state callback
 * @param {Function} settings.onComplete - Animation state callback
 * @param {Function} settings.onStart - Animation state callback
 * @param {Function} settings.onEnd - Animation state callback
 * @returns Returns a component object to be attached to an entity.
 */
bento.define('bento/components/three/spine', [
    'bento',
    'bento/utils',
    'bento/eventsystem'
], function (
    Bento,
    Utils,
    EventSystem
) {
    'use strict';
    // var skeletonRenderer;
    // var debugRendering = false;
    var SPINE = window.spine;
    var emptyImage = document.createElement("img");
    var fakeTexture = new SPINE.FakeTexture(emptyImage);

    var Spine = function (settings) {
        var spineName = settings.spineName || settings.spine;
        var skin = settings.skin || 'default';
        var currentAnimation = settings.animation || 'default';
        var isLooping = Utils.getDefault(settings.loop, true);
        // animation state listeners
        var onEvent = settings.onEvent || function (trackIndex, event) {};
        var onComplete = settings.onComplete || function (trackIndex, loopCount) {};
        var onStart = settings.onStart || function (trackIndex) {};
        var onEnd = settings.onEnd || function (trackIndex) {};
        var currentAnimationSpeed = Utils.isDefined(settings.speed) ? settings.speed : 1;
        var parent3D = settings.parent3D || new THREE.Object3D();
        var overwriteParent3D = !!settings.parent3D;
        var disposeGeometry = Utils.getDefault(settings.disposeGeometry, true);
        var disposeMaterial = Utils.getDefault(settings.disposeMaterial, true);
        // todo: investigate internal scaling
        var spineScale = settings.spineScale || 0.005;
        var atlas, atlasLoader, skeletonMesh, skeletonData, skeletonJson;

        var animationKeys = [];

        var spineAssets, spineData, bounds;
        var setupSpine = function (spine, onSetup) {
            var getLazyLoadPromise = function (path) {
                return new Promise(function (resolve, reject) {
                    spine.loadImage(path, resolve);
                });
            };
            var onTextureAtlas = function (path) {
                var packedImage = spine.images[path];
                var skinImages = spine.skinImages[skin];
                if (packedImage) {
                    return new SPINE.threejs.ThreeJsTexture(packedImage.image);
                } else {
                    // determine if texture is truly needed for the current skin, otherwise we can skip it
                    if (skinImages.indexOf(path) >= 0) {
                        // console.log('Spine3d: ' + path + ' will be lazy loaded');
                        lazyLoadPromises.push(getLazyLoadPromise(path));
                    }

                    return fakeTexture;
                }
            };
            var lazyLoadPromises = [];
            atlas = new SPINE.TextureAtlas(spine.atlas, onTextureAtlas);

            atlasLoader = new SPINE.AtlasAttachmentLoader(atlas);
            skeletonJson = new SPINE.SkeletonJson(atlasLoader);
            // Set the scale to apply during parsing, parse the file, and create a new skeleton.

            skeletonJson.scale = spineScale;
            skeletonData = skeletonJson.readSkeletonData(spine.jsonRaw);

            // Create a SkeletonMesh from the data and attach it to the scene
            skeletonMesh = new SPINE.threejs.SkeletonMesh(skeletonData, function (parameters) {
                parameters.depthTest = false;
            });

            skeletonMesh.skeleton.setSkinByName(skin);

            skeletonMesh.state.addListener({
                event: onEvent,
                complete: function (trackIndex, loopCount) {
                    if (onComplete) {
                        onComplete(trackIndex, loopCount);
                    }
                },
                start: onStart,
                end: onEnd
            });

            if (Utils.isDefined(settings.alpha)) {
                skeletonMesh.skeleton.color.a = settings.alpha;
            }

            parent3D.add(skeletonMesh);
            animationKeys = skeletonData.animations.map(anim => anim.name);
            if (animationKeys.indexOf(currentAnimation) > -1) {
                skeletonMesh.state.setAnimation(0, currentAnimation, isLooping);
            } else {
                console.log('"' + currentAnimation + '" does not exist!');
                console.log(animationKeys);
            }

            // lazyload any missing images
            if (lazyLoadPromises.length) {
                Promise.all(lazyLoadPromises).then(function () {
                    setSkin(onSetup);
                }).catch(function (err) {
                    console.error('Setup Spine Error:', err);
                });
            } else if (onSetup) {
                onSetup();
            }

        };
        var calculateBounds = function (skeleton) {
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
        /**
         * Sets skin by setting up the spine skeleton again
         * Setting skin may cause a new lazy load if the skin images weren't loaded
         */
        var setSkin = function (onSkinSet) {
            // cache animation time
            var oldAnimTime = Utils.getSafe(skeletonMesh, ['state', 'tracks', 0, 'trackTime'], 0);
            // done loading all images: remove previous mesh and re-setup spine
            parent3D.remove(skeletonMesh);
            setupSpine(spineData, onSkinSet);

            // apply time to currrent animation
            if (animationKeys.indexOf(currentAnimation) > -1) {
                var animTime = oldAnimTime;
                var entry = skeletonMesh.state.setAnimation(0, currentAnimation, isLooping);
                entry.trackTime = animTime;
            }
        };
        /**
         * Extends parent entity with these functions
         */
        var entityFunctions = {
            /**
             * Set animation
             * @function
             * @instance
             * @param {String} name - Name of animation
             * @param {Function} [callback] - Callback on complete, will overwrite onEnd if set
             * @param {Boolean} [loop] - Loop animation
             * @name setAnimation
             * @snippet #Spine3D.setAnimation|snippet
                setAnimation('$1');
             * @snippet #Spine3D.setAnimation|callback
                setAnimation('$1', function () {
                    $2
                });
             */
            setAnimation: function (name, callback, loop, mix) {
                if (currentAnimation === name) {
                    // already playing
                    return;
                }
                // update current animation
                if (animationKeys.indexOf(name) > -1) {
                    currentAnimation = name;
                    // reset speed
                    currentAnimationSpeed = 1;
                    isLooping = Utils.getDefault(loop, true);
                    // apply animation
                    var entry = skeletonMesh.state.setAnimation(0, name, isLooping);
                    // set callback, even if undefined
                    onComplete = callback;
                    if (Utils.isDefined(mix)) {
                        entry.mixDuration = mix;
                    } else {
                        entry.mixDuration = 0;
                    }
                } else {
                    console.log('"' + name + '" does not exist!');
                    console.log(animationKeys);
                }
            },
            /**
             * Set animation undocumented version, used by director entity
             */
            setAnim: function (name, loop, continued, time) {
                if (currentAnimation === name) {
                    // already playing
                    return;
                }
                // update current animation
                if (animationKeys.indexOf(name) > -1) {
                    currentAnimation = name;
                    // reset speed
                    // currentAnimationSpeed = 1;
                    isLooping = Utils.getDefault(loop, true);
                    // apply animation
                    var animTime = 0;
                    if (skeletonMesh.state && skeletonMesh.state.tracks && skeletonMesh.state.tracks[0]) {
                        animTime = skeletonMesh.state.tracks[0].trackTime;
                    } else {
                        console.log('WARNING: Animation track does not exist, Spine did not have an animation set?');
                    }
                    var entry = skeletonMesh.state.setAnimation(0, name, isLooping);
                    // set callback, even if undefined
                    if (continued) {
                        entry.trackTime = animTime;
                    } else {
                        entry.trackTime = time;
                    }
                } else {
                    console.log('"' + name + '" does not exist!');
                    console.log(animationKeys);
                }
            },
            /**
             * Get current animation name
             * @function
             * @instance
             * @name getAnimation
             * @snippet #Spine3D.getAnimation|String
                getAnimation();
             * @returns {String} Returns name of current animation.
             */
            getAnimationName: function () {
                return currentAnimation;
            },
            /**
             * Get names of all animations
             * @function
             * @instance
             * @name getAllAnimationNames
             * @snippet #Spine3D.getAllAnimationNames|String
                getAllAnimationNames();
             * @returns {String} Returns array of animation names.
             */
            getAllAnimationNames: function () {
                return animationKeys;
            },
            /**
             * Get speed of the current animation, relative to Spine's speed
             * @function
             * @instance
             * @returns {Number} Speed of the current animation
             * @name getCurrentSpeed
             * @snippet #Spine3D.getCurrentSpeed|Number
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
             * @snippet #Spine3D.setCurrentSpeed|snippet
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
             * @snippet #Spine3D.getSpineData|snippet
                getSpineData();
             */
            getSpineData: function () {
                return {
                    name: spineName,
                    spine: spineData,
                    skeletonData: skeletonData,
                    animationState: skeletonMesh.state
                };
            },
            getObject3D: function () {
                return skeletonMesh;
            },
            clearTracks: function () {
                skeletonMesh.state.clearTracks();
                currentAnimation = '';
            },
            dispose: function (data) {
                if (skeletonMesh) {
                    skeletonMesh.dispose();
                }
                boundingPlane.geometry.dispose();
                boundingPlane.material.dispose();
            },
            getBounds: function (force) {
                if (force) {
                    bounds = calculateBounds(skeletonMesh.skeleton);
                }
                return {
                    x: bounds.offset.x,
                    y: bounds.offset.y,
                    width: bounds.size.x,
                    height: bounds.size.y
                };
            },
            setSkin: function (newSkin, onSkinSet) {
                skin = newSkin;
                setSkin(onSkinSet);
            }
        };

        var boundingPlaneGeometry = new THREE.PlaneBufferGeometry(1, 1);
        var boundingPlaneMaterial = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            alphaTest: 0,
            // visible: false,
        });
        var boundingPlane = new THREE.Mesh(boundingPlaneGeometry, boundingPlaneMaterial);
        var targetScene = settings.scene || Bento.getRenderer().three.scene;

        var component = {
            name: 'spineComponent',
            start: function (data) {
                if (!overwriteParent3D) {
                    targetScene.add(parent3D);
                }
            },
            attached: function (data) {
                spineAssets = Bento.assets.getSpine3D(spineName);
                spineData = spineAssets;
                setupSpine(spineData);
                bounds = calculateBounds(skeletonMesh.skeleton);
                boundingPlane.scale.x = bounds.size.x;
                boundingPlane.scale.y = bounds.size.y;
                boundingPlane.position.x = bounds.size.x / 2 + bounds.offset.x;
                boundingPlane.position.y = bounds.size.y / 2 + bounds.offset.y;
                
                parent3D.add(skeletonMesh);
                
                data.entity.extend(entityFunctions);

            },
            destroy: function (data) {
                if (!overwriteParent3D) {
                    targetScene.remove(parent3D);
                }

                // dispose
                if (disposeGeometry) {
                    if (skeletonMesh) {
                        skeletonMesh.dispose();
                    }
                    boundingPlaneGeometry.dispose();
                }
                if (disposeMaterial) {
                    boundingPlaneMaterial.dispose();
                }
            },
            update: function (data) {
                // update the animation
                if (skeletonMesh) {
                    skeletonMesh.update(data.deltaT / 1000 * data.speed * currentAnimationSpeed);
                }
            },
            draw: function (data) {
                if (!overwriteParent3D) {
                    // render on top of Bento renderer
                    data.renderer.render(parent3D);
                }
            },
            getSkeletonMesh: function () {
                return skeletonMesh;
            },
            getCurrentAnimationSpeed: function () {
                return currentAnimationSpeed;
            },
            setCurrentAnimationSpeed: function (v) {
                currentAnimationSpeed = v;
            }
        };

        Utils.extend(component, entityFunctions);
        
        return component;
    };
    return Spine;
});