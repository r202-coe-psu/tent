pipeline {
    agent { label 'mgmt' }

    stages {
        stage('Deploy to Staging Server') {
            when {
                branch 'staging'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-staging-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-staging-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-staging-port', variable: 'SSH_PORT')
                ]) {
                    sh '''
                        echo "Starting deployment to Staging server..."
                        
                        ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "
                            
                            echo '==> Deploying Tent to Staging...'
                            cd /home/projects/tent
                            git -C /home/projects/tent pull
                            
                            echo '==> Building frontend image...'
                            docker compose -f docker-compose.staging.no-nginx.yml build frontend
                            
                            echo '==> Syncing CouchDB Design Docs & Schema...'
                            docker compose -f docker-compose.staging.no-nginx.yml run --rm frontend pnpm db:sync
                            
                            echo '==> Starting services...'
                            docker compose -f docker-compose.staging.no-nginx.yml up -d --build --force-recreate
                        "
                        echo "Deployment process finished successfully!"
                    '''

                }
            }
        }

        stage('Trigger Staging E2E') {
            when {
                branch 'staging'
            }
            steps {
                catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE', message: 'Unable to enqueue Staging E2E') {
                    withCredentials([
                        sshUserPrivateKey(credentialsId: 'tent-staging-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                        string(credentialsId: 'tent-staging-host', variable: 'SSH_HOST'),
                        string(credentialsId: 'tent-staging-port', variable: 'SSH_PORT')
                    ]) {
                        script {
                            def deployedCommit = sh(
                                returnStdout: true,
                                script: '''
                                    set +x
                                    ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
                                        "git -C /home/projects/tent rev-parse HEAD"
                                '''
                            ).trim()

                            if (!(deployedCommit ==~ /[0-9a-f]{40}/)) {
                                error("Invalid deployed Staging commit: ${deployedCommit}")
                            }

                            echo "Queueing tent-e2e-staging for ${deployedCommit}"
                            build job: 'tent-e2e-staging',
                                  parameters: [
                                      string(name: 'DEPLOY_COMMIT', value: deployedCommit),
                                      string(name: 'STAGING_URL', value: 'https://shelter.importstar.dev')
                                  ],
                                  wait: false,
                                  propagate: false
                        }
                    }
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-prod-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-prod-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-prod-port', variable: 'SSH_PORT')
                ]) {
                    sh '''
                        echo "Starting deployment to Production server..."
                        
                        ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "
                            echo '==> Deploying Tent to Production...'
                            cd /home/projects/tent
                            git -C /home/projects/tent pull
                            
                            echo '==> Building frontend image...'
                            docker compose -f docker-compose.production.no-nginx.yml build frontend
                            
                            echo '==> Syncing CouchDB Design Docs & Schema...'
                            docker compose -f docker-compose.production.no-nginx.yml run --rm frontend pnpm db:sync
                            
                            echo '==> Starting services...'
                            docker compose -f docker-compose.production.no-nginx.yml up -d --build --force-recreate
                        "
                        echo "Deployment process finished successfully!"
                    '''
                }
            }
        }
    }

    post {
        always {
            cleanWs(cleanWhenNotBuilt: false,
                    deleteDirs: true,
                    disableDeferredWipeout: true,
                    notFailBuild: true)
        }
    }
}
