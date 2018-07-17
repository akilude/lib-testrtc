'use strict';

module.exports = function(grunt) {

  grunt.loadNpmTasks('grunt-concurrent');
  grunt.loadNpmTasks('grunt-eslint');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-browserify');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-serve');

  grunt.registerTask('default', ['eslint']);
  grunt.registerTask('build', ['clean', 'browserify', 'uglify']);
  grunt.registerTask('sample', ['build', 'concurrent:hotBuild']);

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

    watch: {
      scripts: {
        files: ['src/**/*.js'],
        tasks: ['build'],
      },
    },

    concurrent: {
      hotBuild: { tasks: ['watch', 'serve'], logConcurrentOutput: true },
    },
  });
};
