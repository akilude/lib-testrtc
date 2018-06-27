'use strict';

module.exports = function(grunt) {

  grunt.loadNpmTasks('grunt-eslint');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-browserify');

  grunt.registerTask('default', ['eslint']);
  grunt.registerTask('build', ['clean', 'browserify', 'uglify']);

  grunt.initConfig({
    clean: {
      build: {
        src: ['dist/*']
      }
    },

    eslint: {
      target: ['src/**/*.js']
    },

    browserify: {
      dist: {
        options: {
          transform: [['babelify', { 'presets': ['babel-preset-env'] }]],
          browserifyOptions: { debug: true }
        },
        files: {
          'dist/testrtc.js': ['src/**/*.js']
        }
      }
    },

    uglify: {
      options: {
        compress: {
          global_defs: {
            'API_KEY': process.env.API_KEY,
            'TURN_URL': 'https://networktraversal.googleapis.com/v1alpha/iceconfig?key='
          },
          dead_code: true,
        },
        beautify: false,
        mangle: true
      },
      target: {
        files: {
          'dist/testrtc-min.js': ['dist/testrtc.js']
        }
      }
    },

  });
};
