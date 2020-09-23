var gulp = require('gulp');
var concat = require('gulp-concat');
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');
var jshint = require('gulp-jshint');
var addsrc = require('gulp-add-src');
var sort = require('gulp-sort');
// var exec = require('gulp-exec');
var exec = require('child_process').exec;
var fs = require('fs');

gulp.task('build', function () {
    // place code for your default task here
    return gulp.src([
            'js/**/*.js',
            '!js/main.js',
            '!js/lib/bento-require.js',
            '!js/lib/require.js',
        ])
        // consistent order
        .pipe(sort())
        // check for mistakes
        /*.pipe(jshint({
            newcap: false
        }))
        .pipe(jshint.reporter())*/
        // place these two files on top
        .pipe(addsrc.prepend('js/main.js'))
        .pipe(addsrc.prepend('js/lib/require.js'))
        // output bento.js
        .pipe(concat('bento.js'))
        .pipe(gulp.dest('build'));
});
gulp.task('updateVersion', function (callback) {
    var pjson = require('./package.json');
    var fs = require('fs');
    var path = require('path');
    var bentojs = path.join('.', 'build', 'bento.js');

    // read package
    fs.readFile(bentojs, 'utf8', function (err, data) {
        if (err) {
            return console.log(err);
        }
        var result = data.replace(/version: (["'])(?:(?=(\\?))\2.)*?\1/g, "version: '" + pjson.version +"'");

        fs.writeFile(bentojs, result, 'utf8', function (err) {
            if (err) {
                callback();
                return console.log(err);
            }
            callback();
        });
    });
});

gulp.task('min', function () {
    // place code for your default task here
    return gulp.src([
            'js/**/main.js',
            'js/lib/lz-string.js',
            'js/lib/audia.js',
            'js/**/*.js',
            '!js/lib/bento-require.js',
            '!js/lib/require.js',
        ])
        // add requirejs
        .pipe(addsrc.prepend('js/lib/require.js'))
        .pipe(concat('bento.js'))
        // output bento.min.js
        .pipe(uglify())
        .pipe(rename('bento.min.js'))
        .pipe(gulp.dest('build'));
});

gulp.task('amdless', function () {
    // place code for your default task here
    return gulp.src([
            'js/**/main.js',
            'js/lib/lz-string.js',
            'js/lib/audia.js',
            'js/**/*.js',
            '!js/lib/bento-require.js',
            '!js/lib/require.js',
        ])
        // add require
        .pipe(addsrc.prepend('js/lib/bento-require.js'))
        // output bento.js
        .pipe(concat('bento-amdless.js'))
        .pipe(uglify())
        .pipe(rename('bento-amdless.min.js'))
        .pipe(gulp.dest('build'));
});

gulp.task('switch', function () {
    // place code for your default task here
    return gulp.src([
            'js/lib/bento-require.js',
            'js/main.js',
            'js/lib/audia.js',
            'js/lib/lz-string.js',
            'native/*.js',
            'js/**/*.js',
            '!js/bento.js',
            '!js/transform.js',
            '!js/entity.js',
            '!js/managers/object.js',
            '!js/math/rectangle.js',
            '!js/math/vector2.js',
            '!js/lib/require.js',
        ])
        .pipe(concat('bento-switch.js'))
        .pipe(gulp.dest('build'));
});

gulp.task('check', function () {
    // place code for your default task here
    return gulp.src(['js/**/main.js', 'js/**/*.js', '!js/lib/*.js'])
        .pipe(jshint({
            newcap: false
        }))
        .pipe(jshint.reporter());
});

gulp.task('watch', function () {
    gulp.watch(
        ['js/**/*.js'], {
            interval: 1000
        }, gulp.series('default')
    );
});

gulp.task('doc', function (cb) {
    exec('jsdoc --verbose -r -c conf.json ./readme.md -d docs -t ./node_modules/minami', function (err, stdout, stderr) {
        console.log(stdout);
        console.log(stderr);
        cb(err);
    });
});

gulp.task('docwatch', function () {
    gulp.watch(
        ['js/**/*.js', './readme.md'], {
            interval: 1000
        }, ['doc']
    );
});

gulp.task('default', gulp.series(
    'build',
    'updateVersion'
));
