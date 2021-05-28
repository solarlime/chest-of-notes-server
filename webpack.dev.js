const NodemonPlugin = require('nodemon-webpack-plugin');
const { merge } = require('webpack-merge');
const common = require('./webpack.common');

module.exports = merge(common, {
  mode: 'development',
  plugins: [new NodemonPlugin()],
});
