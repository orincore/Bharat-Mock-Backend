require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { ApolloServer } = require('@apollo/server');
const { graphqlUploadExpress } = require('graphql-upload-minimal');
const passport = require('./config/passport');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const typeDefs = require('./graphql/typeDefs');
const resolvers = require('./graphql/resolvers');
const { buildContext } = require('./graphql/context');

const authRoutes = require('./routes/authRoutes');
const examRoutes = require('./routes/examRoutes');
const resultRoutes = require('./routes/resultRoutes');
const collegeRoutes = require('./routes/collegeRoutes');
const courseRoutes = require('./routes/courseRoutes');
const articleRoutes = require('./routes/articleRoutes');
const blogRoutes = require('./routes/blog');
const taxonomyRoutes = require('./routes/taxonomyRoutes');
const subcategoryContentRoutes = require('./routes/subcategoryContentRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const pageContentRoutes = require('./routes/pageContent');
const categoryPageContentRoutes = require('./routes/categoryPageContent');
const adminRoutes = require('./routes/adminRoutes');
const { startSubscriptionJobs } = require('./jobs/subscriptionJobs');
const homepageRoutes = require('./routes/homepageRoutes');
const navigationRoutes = require('./routes/navigationRoutes');
const footerRoutes = require('./routes/footerRoutes');
const contactRoutes = require('./routes/contactRoutes');
const aboutRoutes = require('./routes/aboutRoutes');
const privacyRoutes = require('./routes/privacyRoutes');
const disclaimerRoutes = require('./routes/disclaimerRoutes');

const app = express();

// Trust first proxy (Nginx) so rate limiting & logging use the real client IP.
app.set('trust proxy', 1);

app.use(helmet());

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://bharatmock.com',
  'https://www.bharatmock.com',
  'https://app.bharatmock.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : defaultAllowedOrigins;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
}));

app.use(compression());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(passport.initialize());

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

if (process.env.NODE_ENV === 'production') {
  app.use('/api/', limiter);
}

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

const API_VERSION = process.env.API_VERSION || 'v1';

app.use(`/api/${API_VERSION}/auth`, authRoutes);
app.use(`/api/${API_VERSION}/exams`, examRoutes);
app.use(`/api/${API_VERSION}/results`, resultRoutes);
app.use(`/api/${API_VERSION}/colleges`, collegeRoutes);
app.use(`/api/${API_VERSION}/courses`, courseRoutes);
app.use(`/api/${API_VERSION}/articles`, articleRoutes);
app.use(`/api/${API_VERSION}/blogs`, blogRoutes);
app.use(`/api/${API_VERSION}/taxonomy`, taxonomyRoutes);
app.use(`/api/${API_VERSION}/subcategories`, subcategoryContentRoutes);
app.use(`/api/${API_VERSION}/page-content`, pageContentRoutes);
app.use(`/api/${API_VERSION}/category-page-content`, categoryPageContentRoutes);
app.use(`/api/${API_VERSION}/homepage`, homepageRoutes);
app.use(`/api/${API_VERSION}/navigation`, navigationRoutes);
app.use(`/api/${API_VERSION}/footer`, footerRoutes);
app.use(`/api/${API_VERSION}/contact`, contactRoutes);
app.use(`/api/${API_VERSION}/about`, aboutRoutes);
app.use(`/api/${API_VERSION}/privacy`, privacyRoutes);
app.use(`/api/${API_VERSION}/disclaimer`, disclaimerRoutes);
app.use(`/api/${API_VERSION}/admin`, adminRoutes);
app.use(`/api/${API_VERSION}/subscriptions`, subscriptionRoutes);

const GRAPHQL_PATH = process.env.GRAPHQL_PATH || '/api/graphql';
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5242880; // 5MB default

let server;

const startServer = async () => {
  try {
    const { expressMiddleware } = await import('@apollo/server/express4');

    const apolloServer = new ApolloServer({
      typeDefs,
      resolvers,
      formatError: (formattedError) => {
        logger.error('GraphQL Error:', formattedError);
        return formattedError;
      }
    });

    await apolloServer.start();

    app.use(
      GRAPHQL_PATH,
      graphqlUploadExpress({ maxFileSize: MAX_UPLOAD_SIZE, maxFiles: 10 }),
      expressMiddleware(apolloServer, {
        context: async ({ req }) => buildContext(req)
      })
    );

    app.use(notFound);
    app.use(errorHandler);

    const PORT = process.env.PORT || 5000;

    server = app.listen(PORT, () => {
      logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📚 API Documentation: http://localhost:${PORT}/api/${API_VERSION}`);
      console.log(`🔗 GraphQL Endpoint: http://localhost:${PORT}${GRAPHQL_PATH}`);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

startServer();
startSubscriptionJobs();

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  if (server) {
    server.close(() => {
      logger.info('Process terminated');
    });
  }
});

module.exports = app;
