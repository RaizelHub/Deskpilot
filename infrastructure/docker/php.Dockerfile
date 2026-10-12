FROM php:8.4-fpm-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libzip-dev libonig-dev libpng-dev libjpeg62-turbo-dev unzip git \
    && docker-php-ext-configure gd --with-jpeg \
    && docker-php-ext-install pdo_pgsql mbstring bcmath pcntl zip gd \
    && pecl install redis && docker-php-ext-enable redis \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY infrastructure/docker/uploads.ini /usr/local/etc/php/conf.d/deskpilot.ini
WORKDIR /var/www/server
COPY apps/server/composer.json apps/server/composer.lock ./
RUN composer install --no-interaction --prefer-dist --no-scripts
COPY apps/server ./
RUN composer dump-autoload --optimize && chown -R www-data:www-data storage bootstrap/cache
USER www-data
CMD ["php-fpm"]
