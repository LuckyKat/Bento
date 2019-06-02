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
        data.renderer.render(this.sprite);
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
        }

        // TODO: cache the PIXI.Texture instead of generating a new one every time
        this.frame = new window.PIXI.Texture(image.texture);
        texture = this.frame;
        rectangle = texture.frame;
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