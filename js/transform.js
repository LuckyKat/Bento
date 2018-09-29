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
        this.matrix = new Matrix();
        this.entity = entity;

        // cache values
        this.oldAlpha = 1;
        this.tx = 0;
        this.ty = 0;
        this.sx = 1;
        this.sy = 1;
        this.r = 0;

        // additional transforms
        this.x = 0;
        this.y = 0;
        this.visible = true; // only checked by entity
    };

    Transform.prototype.draw = function (data) {
        var entity = this.entity;
        var matrix = this.matrix;
        var alpha = entity.alpha;
        var rotation = entity.rotation;
        var renderer = data.renderer;
        var viewport = data.viewport;
        var tx = 0;
        var ty = 0;
        var sx = entity.scale.x;
        var sy = entity.scale.y;

        // translate
        if (Transform.subPixel) {
            tx += entity.position.x + this.x;
            ty += entity.position.y + this.y;
        } else {
            tx += Math.round(entity.position.x + this.x);
            ty += Math.round(entity.position.y + this.y);
        }
        // scroll (only applies to parent objects)
        if (!entity.parent && !entity.float) {
            tx += -viewport.x;
            ty += -viewport.y;
        }

        //this is an 'irreversable' operation, so we'll have to use save and restore
        if (!sx || !sy) {
            renderer.save();
        }

        // transform
        renderer.translate(tx, ty);
        if (entity.rotation % twoPi) {
            // rotated?
            renderer.rotate(rotation);
        }
        renderer.scale(sx, sy);
        this.oldAlpha = data.renderer.getOpacity();
        renderer.setOpacity(this.oldAlpha * alpha);

        // cache transforms
        this.tx = tx;
        this.ty = ty;
        this.sx = sx;
        this.sy = sy;
        this.r = rotation;

        return true;
    };

    Transform.prototype.postDraw = function (data) {
        var renderer = data.renderer;

        //this was an 'irreversable' operation, so we'll have to use save and restore
        if (!this.sx || !this.sy) {
            renderer.restore();
            return;
        }

        // restore transforms
        renderer.setOpacity(this.oldAlpha);
        renderer.scale(1 / this.sx, 1 / this.sy);
        if (this.r % twoPi) {
            // rotated?
            renderer.rotate(-this.r);
        }
        renderer.translate(-this.tx, -this.ty);
    };

    Transform.prototype.getWorldPosition = function () {
        return this.toWorldPosition(this.entity.position);
    };

    Transform.prototype.toWorldPosition = function (localPosition) {
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