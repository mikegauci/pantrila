-- Recipe corpus, ingredients, embeddings and the indexes behind hybrid search.

create extension if not exists vector;

create table recipes (
    id              text primary key,
    title           text not null,
    summary         text not null,
    cuisine         text not null,
    meal_types      text[] not null,
    diet_tags       text[] not null,
    allergens       text[] not null,
    total_minutes   integer not null check (total_minutes > 0),
    servings        integer not null check (servings > 0),
    steps           text[] not null,
    kcal            numeric(7, 1) not null,
    protein_g       numeric(6, 1) not null,
    carbs_g         numeric(6, 1) not null,
    fat_g           numeric(6, 1) not null,
    fibre_g         numeric(6, 1) not null,
    -- Space-separated ingredient names, kept on the row so full text can index it.
    ingredient_text text not null,
    search_tsv      tsvector generated always as (
        setweight(to_tsvector('english'::regconfig, title), 'A')
        || setweight(to_tsvector('english'::regconfig, replace(cuisine, '_', ' ')), 'B')
        || setweight(to_tsvector('english'::regconfig, summary), 'B')
        || setweight(to_tsvector('english'::regconfig, ingredient_text), 'C')
    ) stored
);

create index recipes_search_tsv_idx on recipes using gin (search_tsv);
create index recipes_diet_tags_idx on recipes using gin (diet_tags);
create index recipes_allergens_idx on recipes using gin (allergens);
create index recipes_meal_types_idx on recipes using gin (meal_types);
create index recipes_total_minutes_idx on recipes (total_minutes);
create index recipes_cuisine_idx on recipes (cuisine);

create table recipe_ingredients (
    recipe_id text not null references recipes (id) on delete cascade,
    position  integer not null,
    name      text not null,
    food      text not null,
    quantity  numeric(10, 2) not null,
    unit      text not null,
    grams     numeric(10, 1) not null,
    primary key (recipe_id, position)
);

create index recipe_ingredients_food_idx on recipe_ingredients (food, recipe_id);

create table recipe_embeddings (
    recipe_id    text primary key references recipes (id) on delete cascade,
    model        text not null,
    content_hash text not null,
    embedding    vector(1536) not null
);

create index recipe_embeddings_hnsw_idx
    on recipe_embeddings using hnsw (embedding vector_cosine_ops);
