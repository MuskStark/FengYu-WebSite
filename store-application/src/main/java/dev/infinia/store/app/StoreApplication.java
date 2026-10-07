package dev.infinia.store.app;

import dev.infinia.store.infrastructure.config.StoreInfrastructureConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.annotation.Import;

/**
 * FengYu-WebSite — the single deployable application (design §5.1).
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@Import(StoreInfrastructureConfig.class)
public class StoreApplication {

    public static void main(String[] args) {
        SpringApplication.run(StoreApplication.class, args);
    }
}
