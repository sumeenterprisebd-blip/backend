const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/Product');

dotenv.config();

const products = [
  {
    name: 'Gradient Graphic T-shirt',
    slug: 'gradient-graphic-tshirt',
    description: 'Stylish gradient graphic t-shirt perfect for casual wear',
    images: ['/logo.jpeg'],
    price: 145,
    originalPrice: null,
    discount: null,
    category: 'T-shirts',
    colors: ['white'],
    sizes: ['S', 'M', 'L', 'XL'],
    dressStyle: 'Casual',
    stock: 50,
    isFeatured: true
  },
  {
    name: 'Polo with Tipping Details',
    slug: 'polo-with-tipping-details',
    description: 'Classic polo shirt with elegant tipping details',
    images: ['/logo.jpeg'],
    price: 180,
    originalPrice: null,
    discount: null,
    category: 'Shirts',
    colors: ['brown'],
    sizes: ['M', 'L', 'XL'],
    dressStyle: 'Casual',
    stock: 30,
    isFeatured: false
  },
  {
    name: 'Black Striped T-shirt',
    slug: 'black-striped-tshirt',
    description: 'Trendy black striped t-shirt with modern design',
    images: ['/logo.jpeg'],
    price: 120,
    originalPrice: 150,
    discount: 30,
    category: 'T-shirts',
    colors: ['black'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    dressStyle: 'Casual',
    stock: 40,
    isFeatured: true
  },
  {
    name: 'Skinny Fit Jeans',
    slug: 'skinny-fit-jeans',
    description: 'Comfortable skinny fit jeans for everyday wear',
    images: ['/logo.jpeg'],
    price: 240,
    originalPrice: 260,
    discount: 20,
    category: 'Jeans',
    colors: ['blue'],
    sizes: ['S', 'M', 'L', 'XL'],
    dressStyle: 'Casual',
    stock: 25,
    isFeatured: false
  },
  {
    name: 'Checkered Shirt',
    slug: 'checkered-shirt',
    description: 'Classic checkered shirt in vibrant colors',
    images: ['/logo.jpeg'],
    price: 180,
    originalPrice: null,
    discount: null,
    category: 'Shirts',
    colors: ['red'],
    sizes: ['M', 'L', 'XL'],
    dressStyle: 'Casual',
    stock: 35,
    isFeatured: false
  },
  {
    name: 'Sleeve Striped T-shirt',
    slug: 'sleeve-striped-tshirt',
    description: 'Unique t-shirt with striped sleeves',
    images: ['/logo.jpeg'],
    price: 130,
    originalPrice: 160,
    discount: 30,
    category: 'T-shirts',
    colors: ['orange'],
    sizes: ['S', 'M', 'L', 'XL'],
    dressStyle: 'Casual',
    stock: 45,
    isFeatured: false
  },
  {
    name: 'Vertical Striped Shirt',
    slug: 'vertical-striped-shirt',
    description: 'Elegant vertical striped shirt',
    images: ['/logo.jpeg'],
    price: 212,
    originalPrice: 232,
    discount: 20,
    category: 'Shirts',
    colors: ['green'],
    sizes: ['M', 'L', 'XL', 'XXL'],
    dressStyle: 'Casual',
    stock: 20,
    isFeatured: false
  },
  {
    name: 'Courage Graphic T-shirt',
    slug: 'courage-graphic-tshirt',
    description: 'Inspirational graphic t-shirt with courage theme',
    images: ['/logo.jpeg'],
    price: 145,
    originalPrice: null,
    discount: null,
    category: 'T-shirts',
    colors: ['orange'],
    sizes: ['S', 'M', 'L', 'XL'],
    dressStyle: 'Casual',
    stock: 50,
    isFeatured: false
  },
  {
    name: 'Loose Fit Bermuda Shorts',
    slug: 'loose-fit-bermuda-shorts',
    description: 'Comfortable loose fit bermuda shorts',
    images: ['/logo.jpeg'],
    price: 80,
    originalPrice: null,
    discount: null,
    category: 'Shorts',
    colors: ['blue'],
    sizes: ['M', 'L', 'XL'],
    dressStyle: 'Casual',
    stock: 30,
    isFeatured: false
  },
  {
    name: 'Classic White Shirt',
    slug: 'classic-white-shirt',
    description: 'Timeless classic white shirt for formal occasions',
    images: ['/logo.jpeg'],
    price: 175,
    originalPrice: 200,
    discount: 25,
    category: 'Shirts',
    colors: ['white'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    dressStyle: 'Formal',
    stock: 40,
    isFeatured: true
  },
  {
    name: 'Cotton Hoodie',
    slug: 'cotton-hoodie',
    description: 'Comfortable cotton hoodie for casual wear',
    images: ['/logo.jpeg'],
    price: 165,
    originalPrice: 190,
    discount: 15,
    category: 'Hoodie',
    colors: ['black'],
    sizes: ['M', 'L', 'XL', 'XXL'],
    dressStyle: 'Casual',
    stock: 35,
    isFeatured: false
  },
  {
    name: 'Denim Jacket',
    slug: 'denim-jacket',
    description: 'Stylish denim jacket for all seasons',
    images: ['/logo.jpeg'],
    price: 195,
    originalPrice: null,
    discount: null,
    category: 'Shirts',
    colors: ['blue'],
    sizes: ['M', 'L', 'XL'],
    dressStyle: 'Casual',
    stock: 25,
    isFeatured: false
  }
];

const seedProducts = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Clear existing products
    await Product.deleteMany({});

    // Insert products
    await Product.insertMany(products);

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
};

seedProducts();

