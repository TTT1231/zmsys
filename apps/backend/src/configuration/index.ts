export default () => ({
  port: parseInt(process.env.PORT, 10) || 5000,
  database: {
    host: process.env.DATABASE_HOST || 3000,
    port: process.env.DB_PORT || 3306,
    userName: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '123456',
    DB_DATABASE: process.env.DB_DATABASE || 'zmdb',
  },
});
