# Changelog

## 1.2.3

* Add **Html** module as HTML helper
* Add **HtmlContainer** GUI module
* `require` is now explicitly attached to *window*
* Three.js shader checks are automatically turned off for non-dev builds (these can cause lots of slowdowns)
* Can pass a color integer toPixi and Three.js Sprites 
* A Sprite can have a different target Three.js *scene*, in case there are multiple scenes present
* Adds *spine3d* asset -> spine files for the Three.js renderer
* Remove several references to Cocoon.io
* Bugfix: Sprite animation frame could be cached after calling Sprite.setup 
* Bugfix: Correct Text dimensions (PR #101) 
* Bugfix: *this* binding in Tweens (PR #125)
* Bugfix: Anchor could have wrong inset values (PR #126)

## 1.2.71

* Hotfix for ThreeLoadingManager that causes Bento to crash on boot when THREE is not present

## 1.2.7

* Add **Anchor** component
* Add **SpriteContainer** component
* Add **Utils.getSafe** function to safely retrieve values deep within object literals 
* Asset manager now includes FBX and GLTF meshes support (dependency: Three.js's FBXLoader and GLTFLoader respectively)
* Bugfix: PixiSprite and ThreeSprite could have the uvs cached when changing animationS
* **Text.linebreaksOnlyOnSpace** feature (PR #116)
* Bugfix: shadow offset in Text would get mutated after applying settings (PR #119)
* **Tweens** support **Vector3D** and **Quaternions** (PR #120)
* Able to set gamma per scene/camera (PR #121)
* Global event listeners (PR #122)
* Sprites can handle *flipY* values in THREE.Texture + Sprites use THREE.BufferGeometry (PR #123)

## 1.2.6 (beta)

* Add **Text.generateText(canvas)** which allows text to be drawn on an external canvas
* Add *lineJoin* parameter to Text and setting the default to *round* instead of *miter*, making strokes on Text look better.
* **Bento.objects.get()** and **Entity.getComponent()** have a 2nd callback in the case of not finding the child.
* Moved pixi renderer to `"pixi3"` renderer, which is only compatible for pixi.js v3
* Updated new `"pixi"` renderer , which is compatible for pixi.js v5 and higher. Note that this removes the `renderer.drawImage` and other draw options.
* Added `"three.js"` renderer. Note that this renderer also has no `renderer.drawImage` and others available.
* The new Renderer setup also required *Sprites* and other visual components to adhere to specific rendering rules. The old Sprite component is moved to `bento/components/canvas2d/sprite`. Sprite will now inherit one of the renderer-specific Sprite classes. This however, means that `bento/components/sprite` can not be included anywhere until `Bento.setup` is called (because this is where the renderer is chosen).
* **NineSlice** is moved to `bento/components/canvas2d/animatednineslice` and **Spine** is moved to `bento/components/canvas2d/animatednineslice`. NineSlice will be re-implemented for the new `pixi` and `three` renderers. 
* Removed NineSlice option from ClickButton (did anyone ever use this?)
* Bugfix: the queries for cache busting were also added to base64 assets, which could break the *build-compact* option.
* Bugfix: horizontal origin of Text did not take margin into account (PR #113).
* Bugfix: PixiSprite did not take packed texture coordinates into account (PR #114).

## 1.2.5

* Dispose canvas textures properly in Text and Tiled modules.
* Text.disposeCanvas is true by default now.
* The dev reload with assets will now also reload images.
* Bounding box correction when Entity's scale is flipped (PR #92)
* EventSystem fix related to looping of events (PR #95)
* Refactoring and fixes of auto resizing. (PR #96) Also will fire the event **resize** after resizing.(PR #107)
* **Rectangle.prototype.includePosition** added (PR 97)
* Tween updatewhenpaused fixed (PR #100)
* Support for DAPI screensize (PR #108)
* Support for Tiled flip flags on object layers (PR #107)
* Documented all events fired by Bento's EventSystem
* Build process: converted all tasks to Gulp 4 (PR #106)
* Build process: consistent order of files
* Bento Empty Project: Added gulp-cache to the imagemin task (biggest bottleneck when building)
* Bento Empty Project: Fixed error with node_modules/gulp-fontmin/index.js not being found
* Bento Empty Project: Removed init steps that were related to Cocoon, added safety event for touch input

## 1.2.4
* Fix possible crash if Sprites and PixiSprites are mixed
* PixiSprite now has an additional parameter called scaleMode where you can pass PIXI.SCALE_MODES.LINEAR or PIXI.SCALE_MODES.NEAREST
* Clear canvas textures (e.g. in the Text module) as soon as possible to prevent memory issues

## 1.2.3
* Added **Bento.saveState.getKeys()** to retrieve all available keys.
* Exposed **Tiled.spawnEntity**, allowing you to spawn an Entity defined in Tiled later
* Pixi textures now get disposed when unloading an asset group. WebGL textures take up quite some memory. Note that proper memory management is still in the hands of the developer.
* Added parameter **autoDisposeTexture** to the Asset Manager (pass this during Game.setup(). This feature will destroy every Pixi texture on a screenHidden event.
* Fixed bug with Text sharpness, as it wasn't properly applied.
* Added the static **Text.defaultSharpness** property to change all sharpness (still defaults to 4x pixel size)
* Fixed a bug with margins around Text. Note that this fix will offset vertically compared to old Text objects (!)
* Pixi renderer optimized for Graphics objects (relates to all drawing functions using primitives). Note that primitives are still slower than sprites.
* Added *useQueries* to Bento settings. This option adds query strings to http calls in the asset manager. This is to combat possible caching in webviews and browsers (Cache Busting).

## 1.2.2
* Fix *Utils.isNativeIos()* and *Utils.isNativeAndroid()* to work on Cordova and not rely on Cocoon

## 1.2.1
* Removed the *manualResize* option in Bento.setup, the automatic resizing behavior by Bento is now removed. Instead use *responsiveResize* which was implemented in the Bento Empty Project before.

## 1.2.0
* Allow external assets to be loaded
* Option to cache Tiled canvasses
* Tile loop is skipped if there is no onTile callback in Tiled, improves performance.
* Transform component and canvas2d renderer refactored: *save* and *restore* no longer calls the internal 2d context save and restore. Instead it saves the current transform matrix. The Transform component keeps track of a local and world transform matrix. Note that these aren't optimally used yet (can improve toWorldPosition and toLocalPosition)
* Re-ordered the properties of Entity. This way the name will show up on top if entities are logged.
* Page visibility can be ignored in the audio manager
* Bento now has an option called **antiAlias** (was called *smoothing* before). Note that anti-aliasing works differently in Cocoon/Pixi, where the option applies to images/textures the moment they are loaded. The same parameter can be passed to Text modules, as these create internal canvasses (textures).
* The **Text** modules creates an internal canvas during start instead of during the constructor. Text.generateOnConstructor is added for legacy purposes (false by default)
* Fixed a bug where **Bento.assets.hasAsset** did not apply for images that were texture-packed
* Option to *"compact-build"* games (see Bento Empty Project). A compact build inlines all assets into a single HTML file. 
* Related to compact builds: assets.json itself can be inlined as javascript with window.assetsJson. This can optionally be represented as an LZString-compressed string.
* **Tweens** are no longer Entities, for improved performance. Tweens as Entities was an uncommon feature, where you could attach components to tweens as well. Instead, if you want tweens inside Entities, **Tween.TweenBehavior** can be called as constructor which acts as a component.
* **Bento.objects.timer** and **Bento.objects.ticker** where timer is affected by game speed.
* Warnings will be logged when the *name* property is not set in Entities and components. Not setting the name is considered bad practice, as there is no way to retrieve the Entity or component without a name.
* Added static functions **Vector2.copyInto(source, target)**, **Vector2.fromRotation(angle, length)** and static properties **Vector2.up**, **Vector2.down**, **Vector2.left**, **Vector2.right**. As well as **Rectangle.copyInto(source, target)**. The *copyInto* functions are also avaible as member functions.
* Option to auto-throttle gamespeed (**autoThrottle**), useful for deltaT enabled games. When turned on, the internal gamespeed automatically adjusted when the game goes below 60fps. Speeds are adjusted down to 20fps (to ignore huge time steps). *Bento.setGameSpeed()* is still relevant, as data.speed is represented as the multiplication of the throttle speed (*Bento.objects.throttle*) and game speed (*Bento.getGameSpeed()*).

## 1.1.0
* Starting a changelog.... finally
* New component: **Modal** pauses everything except the parent entity, great for popups and UI
* New component: **EventListener** Instead of using EventSystem.on and EventSystem.off, this component binds a listeners automatically, with its lifetime of the parent entity. It can also pause the listener if the entity itself is paused.  
* New component: **Spine** Note: Implemented for Canvas2D only. It's function are sort of similar to Sprite.
* New GUI module: **ScrollingList** A list of items that can be scrolled using touch input.
* New GUI module: **CenteredList** A list of items that that are spaced equally.
* Fixed getWorldPosition and toWorldPosition (notable when one of the parent entities was scaled or rotated)
* Fixed overlapping ClickButtons intercepting a click even though one of them is inactive
* Added *active* property to ClickButtons. It was quite confusing that a ClickButton could use a *visible* property but it's active state was using a *setActive* method.
* Clickbutton is allowed again to have *frameCountX: 1* and *frameCountY: 1* again. In that case, the up, down and inactive sprite frames all use frame 0.
* The Entity.collidesWith *withComponent* parameter is removed.
* Static **Text.disposeCanvas** member to dispose the internal canvas on destroy (dispose is a cocoon feature)
* Tiled has an additional *cacheModules* setting, which will cache RequireJS and will be able to synchronously call modules if they were loaded before. Use the *clearCache* method to delete the cache.
* Tiled's *onSpawn* includes a *properties* key.
* Tiled's *onLayer* and *onSpawn* callback include a layer index parameter. 
* Added **buttonUp-\<key\>** events, fired by the input manager. There were *buttonDown-\<key\>* events before, but no equivalent buttonUp events.
* Tiled and Bento.assets can load synchronously. (Needed for native version of Bento)
* Tween no longer overwrites the entity functions, instead the tween is a behavior attached to the entity.
* Added **Bento.assets.forceHtml5Audio**, call this before the assets are loaded.
* The AMD-less version of Bento now loads modules on demand (instead of doing that all beforehand). This behavior is more similar to RequireJS and is able to catch circular dependencies.
* Unlisted Entity.family and Entity.components as members of Entity. It is now considered bad practice to interact with these arrays. (May need to add new functions, for example to get the sizes of these arrays etc.)
* Updated snippets
